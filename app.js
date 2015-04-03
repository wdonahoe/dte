require('newrelic');
var express           = require('express');
var path              = require('path');
var favicon           = require('serve-favicon');
var cookieParser      = require('cookie-parser');
var bodyParser        = require('body-parser');
var mongoose          = require('mongoose');
var passport          = require('passport');
var flash             = require('connect-flash');
var morgan            = require('morgan');
var session           = require('express-session');
var nodemailer        = require('nodemailer');
var schedule          = require('node-schedule');
var async			  = require('async');
var configDB          = require('./config/db');
var configNodemailer  = require('./config/nodemailer');
var Event             = require('./models/event');
var User 			  = require('./models/user');

var app               = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// required for passport
app.use(session({secret: 'whatislove?'}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/blog',express.static(path.join(__dirname, 'public')));
app.use('/recipes',express.static(path.join(__dirname, 'public')));
app.use('/events',express.static(path.join(__dirname, 'public')));
app.use('/admin',express.static(path.join(__dirname, 'public')));
app.use('/admin/mailinglists',express.static(path.join(__dirname, 'public')));
app.use('/events/shifts',express.static(path.join(__dirname, 'public')));
app.use('/admin/users',express.static(path.join(__dirname, 'public')))

var smtpTransport = nodemailer.createTransport("SMTP",{
	 service: configNodemailer.service,
	 auth: {
			 user: configNodemailer.email,
			 pass: configNodemailer.pass,
	 }
});

require('./config/passport.js')(app,passport);
require('./routes.js')(app, passport, smtpTransport);


// connect to the database.
function connectDB(url){	
	mongoose.connect(url);
	var db = mongoose.connection;
	db.once('open',function(open){
		console.log('connected to ' + db.name + ' on ' + db.host + ' on port ' + db.port);
	});
	db.on('error',function(err){
		console.error(err);
	});
}

if (app.get('env') === 'development') {
	
	// development error handler
	connectDB(configDB.devurl);
	mongoose.set('debug', true);
		app.use(function(err, req, res, next) {
				res.status(err.status || 500);
				res.render('error', {
						message: err.message,
						error: err
				});
		});
} else if (app.get('env') === 'production') {

	// production error handler
	// no stacktraces leaked to user
	connectDB(configDB.productionurl);
	app.use(function(err, req, res, next) {
		res.status(err.status || 500);
		res.render('error', {
				message: err.message,
				error: {}
			});
	});
}

// catch 404 and forward to error handler
app.use(function(req, res, next) {
		var err = new Error('Not Found');
		err.status = 404;
		next(err);
});

var rule = new schedule.RecurrenceRule();
var rule2 = new schedule.RecurrenceRule();
rule.hour = [0,8,16,20]
rule2.hour = 12

var j = schedule.scheduleJob(rule,function(err){
	var now = new Date();

	Event.find({},function(err,events){
		if (err)
			throw err
		async.forEach(events,function(event,callback){
			if (+event.reminder.send <= +now && !event.reminder.sent){
				User.find({_id : {$in : event.attendees}},function(err,users){
					if (err)
						throw err
					for (var i = 0; i < users.length; i++){
						//sendMail("Event reminder from Down To Earth",event.reminderMsg,users[i].email)
						console.log('sending mail to ' + users[i].email);
					}
					event.reminder.sent = true;
					event.save(callback);
				});
			}
		},function(err){
			console.log('done');			
		});
	});
});

var k = schedule.scheduleJob(rule2,function(err){
	var now = new Date();
	
	Event.find({},function(err,events){
		if (err)
			throw err
		async.forEach(events,function(event,callback){
			if (+event.time.startTime <= +(now.valueOf() - 240 * 60 * 60 * 1000)){ // longer than two weeks ago
				event.remove(callback);
			}
		},function(err){
			console.log('done');
		})
	})
})

function sendMail(title,body,email){
	smtpTransport.sendMail({
		from: "DTE temporary <" + configNodemailer.email + ">",
		to: email,
		subject:title,
		html:body },
		function(err,res){
			if (err)
				throw err
			console.log("Message sent to " + email);			
	}); 
}

function callback(){
	console.log('done');
}


module.exports = app;
