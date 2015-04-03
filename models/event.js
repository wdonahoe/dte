var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var _ = require('underscore');

var shiftSchema = new Schema({
	name : String,
	attendees : [
					{user_id:Schema.ObjectId,name:String}
				],
	time : {
			 startTime: Date,
			 endTime: Date
		    },
	max : Number
})

var eventSchema = new Schema({
	title : String,
	shifts : [shiftSchema],
	attendees : [Schema.ObjectId],
	location : String,
	description : String,
	time : { 
				startTime: Date,
			 	endTime: Date
		    },
	reminder : {
				 send: Date,
				 sent: Boolean
			    },
	reminderMsg : String,
	gcal_id : String
});

module.exports = mongoose.model('event',eventSchema);