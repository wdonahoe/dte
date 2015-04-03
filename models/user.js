var mongoose = require('mongoose');
var bcrypt = require('bcrypt-nodejs');
var _ = require('underscore');
var Schema = mongoose.Schema;

function validatePresenceOf(value) {
    return value && value.length;
}

var userSchema = new Schema({
	email 			 : {
		type		 : String,
		match		 : [/.+\@.+\..+/, 'Please enter a valid email'],
		validate     : [validatePresenceOf, 'Email cannot be blank'],
		unique		 : true
	},
	google           : {
        id           : String,
        accessToken  : String,
        email        : String,
        name         : String
    },
	password: String,
	priviledge: String,
	name: String,
	isUser: Boolean,
	liked : [Schema.ObjectId]
});

userSchema.methods.generateHash = function(password){
	return bcrypt.hashSync(password, bcrypt.genSaltSync(8), null);
}

userSchema.methods.validPassword = function(password){	
	return bcrypt.compareSync(password, this.password);
}

userSchema.statics.getUsers = function(done){
	this.find({password: {$exists : true}}).sort('priviledge').exec(function(err,users){
		if (err)
			throw err
		return done(null,users);		
	});
}

userSchema.statics.getMembers = function(done){
	this.find().exec(function(err,users){
		if (err)
			throw err
		return done(null,users);
	})
}

userSchema.statics.getIDs = function(done){
	this.find().exec(function(err,users){
		if (err)
			throw err
		ids = [];
		for (var i = 0; i < users.length; i++){
			ids.push(users[i]._id);
		}
		return done(null,ids);
	});
}

userSchema.statics.getEmails = function(done){
	this.find().exec(function(err,users){
		if (err)
			throw err
		ids = [];
		for (var i = 0; i < users.length; i++){
			ids.push(users[i].email);
		}
		return done(null,ids);
	});
}

userSchema.statics.getIDSet = function(ids,done){
	this.find().exec(function(err,users){
		if (err)
			throw err
		user_ids = [];
		for (var i = 0; i < users.length; i++){
			user_ids.push(users[i]._id);
		}
		for (var i = 0; i < ids.length; i++){
			if (!_.contains(user_ids,ids[i]))
				throw err
		}
		return done(null,user_ids);
	})
}

userSchema.methods.getUser = function(id,done){
	this.findById(id, function(err,user){
		if (err)
			throw err;
		return done(null,user);
	});
}

module.exports = mongoose.model('user',userSchema);
