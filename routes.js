var Blog 			= require('./models/blog');
var User 			= require('./models/user');
var MailingList 	= require('./models/mailingList');
var Event 			= require('./models/event');
var async 			= require('async');
var fs             	= require('fs-extra');
var formidable      = require('formidable');
var util 			= require('util');
var _ 				= require('underscore');
var moment			= require('moment')
var google			= require('./config/google-dev')
var request 		= require('request')
var gcal 			= require('google-calendar')

var SCOPE = 'https://www.googleapis.com/auth/calendar'
var tokenUrl = 'https://accounts.google.com/o/oauth2/token'
var calendar_ID = google.calendar_ID
var gcalData = {
	'client_secret':google.client_secret,
	'grant_type':'refresh_token',
	'refresh_token':google.refresh_token,
	'client_id':google.client_ID
}

// TODO  
// update calendar at app.post(/api/shifts/:id), app.post('/events')
// Load text areas with current members.
// 

// DONE
 
module.exports = function(app, passport, smtpTransport){

	// =================================
	// HOME PAGE =======================
	// =================================
	app.get('/',function(req,res,next){
		res.render('index',{isLoggedIn:req.isAuthenticated()});
	});

	app.get('/api/shifts/:id',function(req,res){
		Event.findById(req.params.id,function(err,event){
			if (err)
				throw err
			res.send(event)
		})
	});

	app.post('/api/shifts/:id',function(req,res){
		var shiftsToAdd = [].concat.apply([],[req.param('shift-selector')]);

		
		Event.findById(req.params.id,function(err,event){
			for (var i = 0; i < event.shifts.length; i++){

				for (var j = 0; j < shiftsToAdd.length; j++){

					if (shiftsToAdd[j] == String(event.shifts[i]._id)){
						if (!_.contains(_.pluck(event.shifts[i].attendees,'name'),req.user.name))
							event.shifts[i].attendees.push({userID:req.user._id,name:req.user.name})						
					}

				}

			}
			if (!_.contains(_.map(event.attendees,function(s){return String(s)}),String(req.user._id))){
				event.attendees.push(req.user._id)
			}
			updateCalendarEvent(event,req.user.email,res,req.params.id)
			/*event.save(function(err){
				if (err)
					throw err
				res.redirect('/events/shifts/' + req.params.id)
			})*/
		}) 
	});

	app.get('/api/users/data',function(req,res){
		async.waterfall(
			[	function(done){
					User.find({'isUser':true},function(err,users){
						done(err,users)
					})
				},
				function(users,done){
					var data = []
					Event.find({}).sort({'time.startTime':-1}).exec(function(err,events){
						data = getUserData(users,events)
						done(err,data)
					})		
				}
			],
			function(err,data){
			if (err)
				throw err
			res.send(data)
		})
	})

	app.get('/admin/users/data',function(req,res){
		res.render('user_data',{isLoggedIn:req.isAuthenticated()})
	})

	// app.get('/api/events',function(req,res){
	// 	Event.find({}).sort({'time.startTime':-1}).exec(function(err,events){
	// 		res.send(events)
	// 	})
	// })

	// =================================
	// ADMIN ===========================
	// =================================
	app.param('admin',function(req,res,next){
		if (!req.user.priviledge == 'admin'){
			res.status(401);
			res.json({"error":"Authorization required!", "code":"401"});
		}
		next();
	});
	app.get('/admin', isAdmin, function(req,res){
		User.getMembers(function(err,users){
			MailingList.find({},function(err,mailingLists){
				res.render('admin',{user:req.user,
									users:users,
									mailingLists:_.filter(mailingLists,function(list){return list.name != 'master'}),
									isLoggedIn:req.isAuthenticated()});
			});
		});
	});
	app.post('/admin',function(req,res){
		var ids = [].concat.apply([],[req.param('promote')]);
		
		User.find({_id : {$in : ids}},function(err,users){

			async.forEach(users,
				function(user,createCallback){
					user.priviledge = 'admin';

					user.save(createCallback);
				},
				function(err){
					if (err)
						throw err
					res.redirect('/admin');
				}
			);
		}); 

	});
	app.post('/admin/mailinglists/delete',function(req,res){
		MailingList.findById(req.param('delete'),function(err,mailingList){

			mailingList.remove(function(err){
				if (err)
					throw err
				res.redirect('/admin');
			});
		});
	});
	app.get('/admin/master',isAdmin, function(req,res){
		res.render('master',{isLoggedIn:req.isAuthenticated(),url:'master'});
	});

	app.get('/admin/users',isAdmin,function(req,res){
		res.render('master',{isLoggedIn:req.isAuthenticated(),url:'users'});
	})

	app.post('/admin/users',function(req,res){
		var requestedEmails = _.map(req.param('emails').split(','), function(email){ return email.trim() });

		User.find({},function(err,allUsers){
			if (err)
				throw err
			async.forEach(allUsers,function(user,deleteCallback){
				if (!_.contains(requestedEmails,user.email)){
					user.isUser = false
				} else {
					user.isUser = true
				}
				user.save(deleteCallback)
			},function(err){
				res.redirect('/admin')
			})
		})
	})
	
	app.post('/admin/master', function(req, res){
		var requestedEmails = _.map(req.param('emails').split(','), function(email){ return email.trim() });

		async.waterfall([
		function(done){ // find all users
			User.find({}, function(err, allUsers){
				done(err, allUsers);
			});
		}, // Create arrays of users to create and delete. 
		function(allUsers,done){
			User.find({'email': {$in : requestedEmails}},function(err, usersToKeep){

				var toKeepEmails = [];
				var allEmails = [];

				for (var i = 0; i < usersToKeep.length; i++){

					toKeepEmails.push(usersToKeep[i].email);

				}
				for (var j = 0; j < allUsers.length; j++){

					allEmails.push(allUsers[j].email);

				}

				var toCreate = _.difference(requestedEmails,allEmails);
				var toDelete = _.difference(allEmails,toKeepEmails);

				done(err,toCreate,toDelete);
			});
		}, // Delete users not to be on the master list. 
		function(toCreate,toDelete,done){
			User.find({'email' : {$in : toDelete}},function(err,deleted){

				async.forEach(deleted,
					function(userToDelete,deleteCallback){
						var id = userToDelete._id;
						userToDelete.remove(deleteCallback);
					},function(err){
						done(err,toCreate,deleted);
					}
				);
			});
		},
		function(toCreate,deleted,done){
			async.forEach(toCreate,
				function(userToCreate,createCallback){
					var newUser = new User({email:userToCreate});

					newUser.save(createCallback);
				},function(err){
					done(err,deleted);
				})
		} // create the mailing list. 
		], function(err,deleted){
				if (err)
					throw err
				updateMasterMailingList(res,deleted);
			}
		);
	});
	app.get('/admin/new_blog',isAdmin, function(req,res){
		res.render('new_blog',{isLoggedIn:req.isAuthenticated()});
	});
	app.post('/admin/new_blog',function(req,res){
		// blog, image, recipe updates go here.
		var blogPost = new Blog({title: req.param('title'),
								 text: req.param('text'),
								 images: req.param('images'),
								 tag: req.param('tag'),
								 date: new Date});
		blogPost.savePost(function(error,docs){
			res.redirect('/blog');
		}); 
	});
	app.get('/admin/new_mailinglist',isAdmin,function(req,res){
		User.getUsers(function(err,users){

			res.render('new_mailinglist',{users:users,isLoggedIn:req.isAuthenticated()});
		});	
	});
	app.post('/admin/new_mailinglist',function(req,res){
		User.getUsers(function(err,users){

			var mailingList = new MailingList({
				name: req.param('name'),
				members: req.param('subscribe'),
				scope: req.param('public'),
				description: req.param('description')
			});
			mailingList.save(function(err){
				if (err)
					throw err;
				res.redirect('/admin'); 
			});
		});
	});
	app.get('/admin/new_event',isAdmin, function(req,res){
		res.render('new_event',{isLoggedIn:req.isAuthenticated()});
	});
	app.post('/admin/new_event',function(req,res){
		
		var startTime = new Date(req.param("date") + " " + req.param("start"));
		var endTime = new Date(req.param("date") + " " + req.param("end"));
		var reminderTime = new Date(startTime.valueOf() - (36 * 60 * 60 * 1000));

		var newEvent = new Event();
		newEvent.title = req.param('title');
		newEvent.description = req.param('description');
		newEvent.location = req.param('location');
		newEvent.time = { startTime: startTime, endTime: endTime };
		newEvent.reminder = { send: reminderTime, sent: false };  

		var reminderMsg = "<p>This is an automated reminder that you are attending " +
						   newEvent.title + 
						   " at " +
						   req.param("start") + 
						   " on " +
						   req.param("date") +
						   " at " + newEvent.location + ".</p><p>If you no longer wish to attend, please un-rsvp via our website. We hope to see you there!</p><p>-Down To Earth</p>";

		newEvent.reminderMsg = reminderMsg;
		newEvent.shifts = []
		if (req.param("shifts") !== undefined){
			for (var i = 0; i < req.param("shifts").length; i++){

				newEvent.shifts.push({
										name:"Shift " + String(i + 1),
										time:{
												startTime:new Date(req.param("shifts")[i]["startTime"]),
												endTime:new Date(req.param("shifts")[i]["endTime"])
											},
										attendees:[]
									})

			}
		}
		else if(req.param("roles") !== undefined){
			for (var i = 0; i < req.param("roles").length; i++){

				newEvent.shifts.push({
					name:req.param("roles")[i],
					attendees:[]
				})

			}
		}
		createCalendarEvent(newEvent,res)
	});

		// newEvent.save(function(err){
		// 	if (err)
		// 		throw err
		// 	res.redirect('/admin');
		// });
	app.post('/admin/new_email',function(req,res){
		MailingList.findById(req.param('id'),function(err,mailingList){

			if (err)
				throw err
			var emails = [];
			User.find({_id: {$in : mailingList.members}},function(err,users){

				if (err)
					throw err
				for (var i = 0; i < users.length; i++){

					emails.push(users[i].email);

				}
				sendMail(req.param('title'),
						req.param('text'),
						emails);
				res.redirect('/admin');
			});
		});
	});
	app.post('/admin/mailinglists/save',function(req,res){
		
		MailingList.findById(req.param('id'),function(err,mailingList){

			var isIn = false;
			for (var i = 0; i < mailingList.savedMessages.length; i++){

				if (mailingList.savedMessages[i].title == req.param('title')){
					mailingList.savedMessages[i].text = req.param('text');
					isIn = true;
					break;
				}

			}
			if (!isIn)
				mailingList.savedMessages.push({title:req.param('title'),text:req.param('text')});
			mailingList.save(function(err){
				if (err)
					throw err
				res.redirect('/admin/mailinglists/' + req.param('id'));
			});
		});
	});
	app.get('/admin/mailinglists/:id',isAdmin,function(req,res){
		User.getUsers(function(err,users){

			MailingList.findById(req.params.id,function(err,mailinglist){

					var new_users = [];
					for (var i = 0; i < users.length; i++){

						new_users.push({
							_id:users[i]._id,
							email:users[i].email,
							priviledge:users[i].priviledge,
							checked:_.contains(_.map(mailinglist.members,function(id){return String(id)}),String(users[i]._id))
						});		

					}
					res.render('mailinglist',{name:mailinglist.name,id:mailinglist._id,users:new_users,isLoggedIn:req.isAuthenticated(),saved:mailinglist.savedMessages});
			});
		});
	});
	app.post('/admin/mailinglists/:id',function(req,res){
		
		MailingList.findById(req.params.id,function(err,mailinglist){	

			mailinglist.updateMembers(req.param('subscribe'),function(err,updated){
				res.redirect('/admin/mailinglists/' + req.params.id)
			});
		}); 
	});

	app.get('/admin/upload',isAdmin,function(req,res){
		res.render('upload_photos',{isLoggedIn:req.isAuthenticated()});
	});

	app.post('/admin/upload',function(req,res){
		var form = new formidable.IncomingForm();
		form.uploadDir = 'public/uploads';
		form.keepExtensions = true;
		var files = [];
		var fields = [];
		form.on('field',function(field,value){
			fields.push([field, value]);
		});
		form.on('file',function(file,value){
        	files.push([file, value]);
		});
		form.parse(req,function(){res.redirect('/gallery')});
	});

	app.get('/admin/members',isAdmin,function(req,res){
		User.find({},function(err,users){
			if (err)
				throw err
			var new_users = [];
				for (var i = 0; i < users.length; i++){

					new_users.push({
						_id:users[i]._id,
						email:users[i].email,
						priviledge:users[i].priviledge,
						checked:users[i].isUser,
						name:users[i].name
					});		
				}

			res.render('all_users',{users:new_users,isLoggedIn:req.isAuthenticated()})

		})
	})

	app.post('/admin/members',function(req,res){
		var del = [].concat.apply([],[req.param('delete')]);

		User.find({_id : {$in : del}},function(err,users){
			if (err)
				throw err
			async.forEach(users,function(user,deleteCallback){
				user.isUser = false
				user.save(deleteCallback)
			},function(err){
				updateMailingLists(res,users);
			})
		})
	})

	// =================================
	// BLOG ============================
	// =================================
	app.get('/blog',function(req,res){
		Blog.getBlogs(function(err,posts){

			res.render('blog',{posts:posts,isLoggedIn:req.isAuthenticated(),pageTitle:'Blog'});
		});
	});
	app.get('/blog/:id',function(req,res){
		Blog.getBlog(req.params.id,function(err,post){

			res.render('blog',{posts:post,isLoggedIn:req.isAuthenticated(),pageTitle:post.title});
		});
	});

	app.post('/blog',function(req,res){
		Blog.getTagged(req.param('tag'), function(err,posts){

			res.render('blog',{posts:posts,isLoggedIn:req.isAuthenticated(),pageTitle:'Blog'})
		});
	});

	// =================================
	// EVENTS ==========================
	// =================================
	app.get('/events',function(req,res){
		var now = new Date()

		Event.find({}).sort('time.startTime').limit(20).exec(function(err,events){

			for (var i = 0; i < events.length; i++){
					if (events[i].shifts.length > 0){
						events[i] = {event:events[i],shifts:true}
					}
					else{
						events[i] = {event:events[i],shifts:false}
					}
			}
				res.render('event',{events:events,isLoggedIn:req.isAuthenticated(),message:"",pageTitle:"Events"});
		});
	});
	app.post('/events',function(req,res){
		var attendMsg = "Thanks for coming!";
		var rejectMsg = "You\'re already signed up for that event!";

		Event.find({},function(err,events){
			for (var i = 0; i < events.length; i++){

				if (events[i]._id == req.param('attend')){
					var attending = events[i];
					if (!_.contains(_.map(attending.attendees,function(s){return String(s)}),String(req.user._id))){
						attending.attendees.push(req.user._id);
						attending.save(function(err){
							if (err)
								throw err
							updateCalendarEvent(events[i],req.user.email,res)
							//res.render('event',{events:events,message:{id:attending._id,msg:attendMsg},isLoggedIn:true,pageTitle:"Events"});
						});
					}
					else {
						res.render('event',{events:events,message:{id:attending._id,msg:rejectMsg},isLoggedIn:true,pageTitle:"Events"});
					}
					break;
				}
			}
		});
	});
	app.get('/events/calendar',function(req,res){
		res.render('calendar');
	});
	app.get('/events/:id',function(req,res){
		Event.findOne({'_id':req.params.id},function(err,event){

			res.render('event',{events:event,isLoggedIn:req.isAuthenticated(),message:"",pageTitle:event.title});
		});
	});
	app.get('/events/shifts/:id',function(req,res){
		res.render('shift',{pageTitle:"Shift Signup",isLoggedIn:req.isAuthenticated()});
	});

	// ================================
	// GALLERY ========================
	// ================================
	app.get('/gallery',function(req,res){
		res.render('gallery',{isLoggedIn:req.isAuthenticated()});
	});	

	app.get('/images',function(req,res){
		fs.readdir('public/uploads',function(err,files){

			res.send({images:files});
		}); 
	});

	// =================================
	// LOGIN ===========================
	// =================================
	app.get('/login',function(req,res){
		res.render('login', {message: req.flash('loginMessage'), isLoggedIn: false });
	});
	app.post('/login', function(req, res, next) {
  		passport.authenticate('local-login', function(err, user, info) {
    		if (err) { return next(err); }
    		if (!user) { return res.redirect('/login'); }
    		req.logIn(user, function(err) {
      			if (err) { return next(err); }
      			if (user.priviledge == 'admin'){ res.redirect('/admin'); }
				else { res.redirect('/profile'); }
    		});
  		})(req, res, next);
	});	

	// =====================================
    // LOGOUT ==============================
    // =====================================
    app.get('/logout', function(req, res) {
        req.logout();
        res.redirect('/');
    });

	// =================================
	// PROFILE =========================
	// =================================
	app.get('/profile',isLoggedIn, function(req,res){

		var userId = req.user._id;
		var locals = {}; 
		locals.events = [];
		locals.mailingLists = [];

		async.parallel([
			function(callback){ // Get events
				Event.find({}, function(err,events){

					for (var i = 0; i < events.length; i++){

						for (var j = 0; j < events[i].attendees.length; j++){
							var now = new Date()
							var start = new Date(events[i].time.startTime)
							if (+start >= +now){
								if (String(events[i].attendees[j]) == String(req.user._id)){
									locals.events.push(events[i]);
									break;
								}
							}
						}

					}
					callback();
				});
			},
			function(callback){ // Get liked recipes // TODO: FIX
				Blog.find({'_id': {$in : req.user.liked}}, function(err,recipes){

					if (err)
						throw err
					locals.recipes = recipes;
					callback();
				});
			},
			function(callback){ // Get subscriptions
				MailingList.find({'scope':true}, function(err,mailingLists){

					if (err)
						throw err
					for (var i = 0; i < mailingLists.length; i++){

						var isIn = false;
						for (var j = 0; j < mailingLists[i].members.length; j++){

							if (String(mailingLists[i].members[j]) == String(userId)){
								isIn = true;
								break;
							}

						}
						locals.mailingLists.push({mailingList:mailingLists[i],isIn:isIn});

					}
					callback();
				});
			}
			],function(err){
				if (err)
					throw err			
				res.render('profile',{user:req.user,events:locals.events,recipes:locals.recipes,mailingLists:locals.mailingLists,isLoggedIn:true,isAdmin:req.user.priviledge == 'admin'});
			});

	});

	app.post('/profile/name',function(req,res){
		User.findOne({'_id':req.user._id},function(err,user){
			if (err)
				throw err
			user.name = req.param("name")
			user.save(function(err){
				if (err)
					throw err
				res.redirect('/profile')
			})
		})
	})

	app.get('/recipes',function(req,res){

		Blog.find({'tag':'recipe'}).sort('date').exec(function(err,recipes){

			if (err)
				throw err
			var newRecipes = []; 
			if (req.user){
				User.findOne({'_id':req.user._id},function(err,user){

					if (err)
						throw err
					var liked = user.liked;
					for (var i = 0; i < recipes.length; i++){

						var like = false;
						for (var j = 0; j < liked.length; j++){

							if (String(liked[j]) == String(recipes[i]._id)){
								like = true;
								break;
							}

						}
						newRecipes.push({body:recipes[i],like:like});

					}
					res.render('recipe',{posts:newRecipes,isLoggedIn:true,pageTitle:"Recipes"});
				});
			} 
			else {
				for (var i = 0; i < recipes.length; i++){

					newRecipes.push({body:recipes[i],liked:false});

				}
				res.render('recipe',{posts:newRecipes,isLoggedIn:false,pageTitle:"Recipes"});
			}
		});

	});	

	// ==================================
	// RECIPES ==========================
	// ==================================

	app.get('/recipes/:id',function(req,res){

		Blog.findOne({'_id':req.params.id},function(err,recipe){
			
			var newRecipe = {};
			if (req.user){
				newRecipe["body"] = recipe;
				var like = false;
				for (var i = 0; i < req.user.liked.length; i++){

					if (String(req.user.liked[i]) == String(recipe._id)){
						like = true;
						break;
					}

				}
				newRecipe["like"] = like;
				res.render('recipe',{posts:[newRecipe],isLoggedIn:req.isAuthenticated(),pageTitle:recipe.title});
			}
			else {
				newRecipe["body"] = recipe;
				newRecipe["like"] = false;
				res.render('recipe',{posts:[newRecipe],isLoggedIn:req.isAuthenticated(),pageTitle:recipe.title});
			} 
		});

	});

	app.post('/user/event/delete',function(req,res){

		var del = [].concat.apply([],[req.param('delete')]);
		
		Event.find({'_id' : {$in : del}},function(err,events){

			async.forEach(events,function(event,deleteCallback){
				for (var i = 0; i < event.attendees.length; i++){

					if (String(req.user._id) == String(event.attendees[i])){
						event.attendees.splice(i,1);
					}

				}
				for (var i = 0; i < event.shifts.length; i++){

					for (var j = 0; j < event.shifts[i].attendees.length; j++){

						if (req.user.name == event.shifts[i].attendees[j]){
							event.shifts[i].attendees.splice(j,1)
						}
					}
				}
				event.save(deleteCallback);
			},function(err){
				res.redirect('/profile');
			});
		});

	});

	// =================================
	// SIGNUP ==========================
	// =================================
	app.get('/signup', function(req,res){

		res.render('signup', { title: 'Sign Up', message: req.flash('signupMessage'), isLoggedIn:false});

	});
	app.post('/signup',passport.authenticate('local-signup',{

		successRedirect: '/profile',
		failureRedirect: '/signup',
		failureFlash: true

	}));

	app.post('/user/recipes/like',function(req,res){

		User.findOne({'_id':req.user._id},function(err,user){

			user.liked.push(req.param('id'));
			user.save(function(err){
				if (err)
					throw err
				res.send(user.liked)
			});
		});

	});

	// ==============================
	// USER =========================
	// ==============================
	app.post('/user/recipes/unlike',function(req,res){

		User.findOne({'_id':req.user._id},function(err,user){

			for (var i = 0; i < user.liked.length; i++){

				if (user.liked[i] == req.param('id')){
					user.liked.splice(i,1);
					break;
				}

			}
			user.save(function(err){
				if (err)
					throw err
			});
		});

	});

	app.post('/user/recipes/delete',function(req,res){

		var del = [].concat.apply([],[req.param('delete')]);
		User.findOne({'_id':req.user._id},function(err,user){

			for (var i = 0; i < user.liked.length; i++){

				for (var j = 0; j < del.length; j++){

					if (String(del[j]) == String(user.liked[i])){
						user.liked.splice(i,1);
						break;
					}

				}

			}
			user.save(function(err){
				if (err)
					throw err
				res.redirect('/profile');
			});
		});

	});

	app.post('/user/mailinglist/update',function(req,res){

		var update = [].concat.apply([],[req.param('update')]);
		//res.send(req.param('update'));
		
		MailingList.find({scope: true}, function(err, mailingLists){

			var alreadySubbed = [];
			for (var i = 0; i < mailingLists.length; i++){

				for (var j = 0; j < mailingLists[i].members.length; j++){

					if (String(req.user._id) == String(mailingLists[i].members[j])){
						alreadySubbed.push(mailingLists[i]);
						break;
					}

				}

			}

			// Remove
			for (var i = 0; i < alreadySubbed.length; i++){

				var isIn = false;
				var j = 0;
				while (j < update.length && !isIn){

					if (String(alreadySubbed[i]._id) == String(update[j]))
						isIn = true;
					j++;

				}
				if (!isIn){
					for (var k = 0; k < alreadySubbed[i].members.length; k++){

						if (String(req.user._id) == String(alreadySubbed[i].members[k])){
							alreadySubbed[i].members.splice(k,1);
							break;
						}
					}
				}

			}
			// Add
			for (var i = 0; i < update.length; i++){

				var isIn = false;
				var j = 0;
				while (j < alreadySubbed.length && !isIn){

					if (String(alreadySubbed[j]._id) == String(update[i]))
						isIn = true;
					j++;

				}
				if (!isIn){
					for (var k = 0; k < mailingLists.length; k++){

						if (String(mailingLists[k]._id) == String(update[i])){
							alreadySubbed.push(mailingLists[k]);
							mailingLists[k].members.push(req.user._id);
							break;
						}
					}
				}

			}
			// Save the lists
			async.forEach(alreadySubbed,function(mailingList,createCallback){
				mailingList.save(createCallback);
			},function(err){
				if (err)
					throw err
				res.redirect('/profile');
			});
		}); 

	});

function createCallback(){

	console.log('done')

}

function deleteCallback(){

	console.log('done')

}

// route middleware to make sure a user is logged in
function isLoggedIn(req, res, next) {

    // if user is authenticated in the session, carry on 
    if (req.isAuthenticated() && req.user.isUser)
        return next();

   	 // if they aren't redirect them to the home page
    res.redirect('/');

}

function isAdmin(req, res, next){

	if (req.isAuthenticated())
		if (req.user.priviledge == 'admin')
			return next();

	res.redirect('/');

}

function isGoogleAuthorized(req,res,next){

	if (req.isAuthenticated() && req.user.priviledge == 'admin')
		if (req.user.google.accessToken != null || req.user.google.accessToken !== undefined)
			return next();

	res.redirect('/profile');

}

function createUsers(users){

	var ids = [];
	for (var i = 0; i < users.length; i++){

		var newUser = new User({email:users[i]});
		var id = newUser._id;

		newUser.save(function(err){
			if (err)
				throw err;
			ids.push(id);
		});

	}
	return ids;

}

function updateMasterMailingList(res,deleted){

	User.find({},function(err,users){

		var ids = [];
		for (var i = 0; i < users.length; i++){

			ids.push(users[i]._id);

		}

		MailingList.findOne({name:'master'},function(err,master){

			if (err)
				throw err
			if (!master){

				var newMaster = new MailingList();
				newMaster.name = 'master';
				newMaster.members = ids;

				newMaster.save(function(err){
					if (err)
						throw err;
					res.redirect('/admin');
				});
			}
			else {
				master.members = ids;
				master.save(function(err){
					if (err)
						throw err
					updateMailingLists(res,deleted);
				})
			}
		});
	});

}

function updateMailingLists(res,deleted){

	var ids = [];
	for (var i = 0; i < deleted.length; i++){

		ids.push(deleted[i]._id);

	}
	MailingList.find({},function(err,mailingLists){
		if (err)
			throw err
		async.forEach(mailingLists,
			function(mailingList,createCallback){
				if (mailingList.name != 'master')
					mailingList.members = _.difference(mailingList.members,ids);

				mailingList.save(createCallback);
			},function(err){
				if (err)
					throw err
				res.redirect('/admin');
			}
		);
	});

}

function sendMail(title,body,emails){

	for (var i = 0; i < emails.length; i++){
		
		smtpTransport.sendMail({
			from: "DTE temporary <downtoearthtest@gmail.com>",
			to: emails[i],
			subject:title,
			html:body },
			function(err,res){
				if (err)
					throw err
				console.log("Message sent to " + emails[i]);			
		}); 
	}

}

function formatDate(date,dateOnly) {

  	var hours = date.getHours();
  	var minutes = date.getMinutes();
  	var ampm = hours >= 12 ? 'pm' : 'am';
  	hours = hours % 12;
  	hours = hours ? hours : 12; // the hour '0' should be '12'
  	minutes = minutes < 10 ? '0'+minutes : minutes;
  	var strTime = hours + ':' + minutes + ' ' + ampm;
  	if (dateOnly)
  		return date.getMonth()+1 + "/" + date.getDate() + "/" + date.getFullYear()
  	return date.getMonth()+1 + "/" + date.getDate() + "/" + date.getFullYear() + "  " + strTime;

}

function timeOnly(date){

	var hours = date.getHours();
  	var minutes = date.getMinutes();
  	var ampm = hours >= 12 ? 'pm' : 'am';
  	hours = hours % 12;
  	hours = hours ? hours : 12; // the hour '0' should be '12'
  	minutes = minutes < 10 ? '0'+minutes : minutes;
  	var strTime = hours + ':' + minutes + ' ' + ampm;

  	return strTime;

}

function updateCalendarEvent(event,email,res,id){
	request.post(tokenUrl,{form:gcalData},function(err,response,body){
		var access_token = JSON.parse(body).access_token
		
		var google_calendar = new gcal.GoogleCalendar(access_token);

		google_calendar.events.get(calendar_ID,event.gcal_id,function(err,e){
			if (err)
				throw err
			var attendee = {"email":email,"responseStatus":"accepted"}
			if (attendees === undefined || attendees == null){
				var attendees = [attendee]
			}else{
				var attendees = e.attendees.concat([attendee])
			}
			var data = {
				"end":{
					"dateTime": e.end.dateTime
				},
				"start":{
					"dateTime": e.start.dateTime
				},
				"attendees": attendees,
				"description": e.description.replace(/<(?:.|\n)*?>/gm, ''), // remove html
				"summary": e.summary,
				"location": e.location
			}
			google_calendar.events.patch(calendar_ID,event.gcal_id,data,function(err,body){
				if (err)
					throw err
				event.save(function(err){
					if (err)
						throw err
					if (id !== undefined)
						res.redirect('/events/shifts/' + id)
					res.redirect('/events')
				})
			})
		})
	})
}

function createCalendarEvent(event,res){
	request.post(tokenUrl,{form:gcalData},function(err,response,body){
		var access_token = JSON.parse(body).access_token
		
		var google_calendar = new gcal.GoogleCalendar(access_token);

		var data = {
			"end": {
				"dateTime": ISODateString(event.time.endTime)
			},
			"start": {
				"dateTime": ISODateString(event.time.startTime)
			},
			"attendees": [],
			"description": event.description.replace(/<(?:.|\n)*?>/gm, ''),
			"summary": event.title,
			"location": event.location
		}

		google_calendar.events.insert(calendar_ID,data,function(err,response){
			if (err)
				throw err
			event.gcal_id = response.id
			event.save(function(err){
				if (err)
					throw err
				res.redirect('/admin')
			})
		})
	})
}

function getUserData(users,events){
	var data = {records:[],queryRecordCount:0,totalRecordCount:0}

	for (var i = 0; i < users.length; i++){
		var user = users[i]
		var timeWorked = 0
		var numberShifts = 0
		var lastEvent = null
		var lastEventDate = 0
		for (var j = 0; j < events.length; j++){
			var e = events[j]
			if (!_.isEmpty(e.shifts)){
				for (var k = 0; k < e.shifts.length; k++){
					var shift = e.shifts[k]
					for (var l = 0; l < shift.attendees.length; l++){
						if (shift.attendees[l].name == user.name){
							 timeWorked += Math.round((shift.time.endTime - shift.time.startTime)*2.778e-7)
							 numberShifts++
							 lastEvent = e.title
							 lastEventDate = formatDate(e.time.startTime,true)
							 break
						}
					}
				}
			}
		}
		data.records.push({
			'n':i+1,
			'name':user.name,
			'email':user.email,
			'last event':lastEvent,
			'last event date':lastEventDate,
			'number of shifts':numberShifts,
			'time worked (hours)':timeWorked
		})
		data.queryRecordCount++
		data.totalRecordCount++
	}
	return data	
}

function ISODateString(d){

	function pad(n){
		return n<10 ? '0'+n : n
	}

 	return d.getUTCFullYear()+'-'
      	+ pad(d.getUTCMonth()+1)+'-'
      	+ pad(d.getUTCDate())+'T'
      	+ pad(d.getUTCHours())+':'
      	+ pad(d.getUTCMinutes())+':'
      	+ pad(d.getUTCSeconds())+'Z'
    }

}


