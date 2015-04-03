var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var blogSchema = new Schema({
	date: Date,
	title: String,
	text: String,
	tag: String,
	isRecipe: Boolean
});


blogSchema.methods.savePost = function(done){
	this.save(function(err){
		if (err)
			throw err;
		return done(null,this);
	});
}

blogSchema.statics.getBlogs = function(done){
	this.find().sort('date').limit(10).exec(function(err,posts){
		if (err)
			throw err;
		return done(null,posts);
	});
}

blogSchema.statics.getTagged = function(tag,done){
	this.find({'tag':tag}).sort('date').exec(function(err,posts){
		if (err)
			throw err;
		return done(null,posts);
	});
}

blogSchema.statics.getBlog = function(query,done){
	this.find({'_id':query}).exec(function(err,post){
		if (err)
			throw err
		return done(null,post);
	});
}

module.exports = mongoose.model('blog',blogSchema)

