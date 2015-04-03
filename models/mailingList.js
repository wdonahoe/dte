var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var User = require('./user');
var _ = require('underscore');

var mailingListSchema = new Schema({
	name: String,
	members: [Schema.ObjectId],
	isMaster: Boolean,
	scope: Boolean,
	savedMessages: [{
		title:String,
		text:String
	}],
	description: String
});

mailingListSchema.statics.getMailingLists = function(done){
	this.find().exec(function(err,mailingLists){
		if (err)
			throw err
		return done(null,mailingLists)
	});
}

mailingListSchema.statics.getMailingList = function(mailingListName,done){
	this.findOne({name:mailingListName},function(err,mailingList){
		if (err)
			throw err;
		return done(null,mailingList);
	});
}

mailingListSchema.methods.getUsers = function(done){
	User.find({_id: {$in: this.members}}, function(err,users){
		if (err)
			throw err;
		return done(null,users);
	});
}


mailingListSchema.methods.updateMembers = function(user_ids,done){
	if (user_ids == null){
		this.remove(function(err){
			if (err)
				throw err
			done(null,this);
		});
	}
	else {
	user_ids = [].concat.apply([],[user_ids]);
	var members = _.map(this.members,function(id){return String(id)});
	var ids = _.map(user_ids,function(id){return String(id)});
	for (var i = 0; i < members.length; i++){
		if (!_.contains(ids,members[i]))
			this.members.splice(i,1);
	}
	for (var i = 0; i < user_ids.length; i++){
		if (!_.contains(members,ids[i]))
			this.members.push(user_ids[i]);
	}
	this.save(function(err){
		if (err)
			throw err;
		return done(null,this);
	});
}
}

module.exports = mongoose.model('mailingList',mailingListSchema);