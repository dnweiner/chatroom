// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
	fs = require("fs");
 
// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
 
	fs.readFile("client.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.
 
		if(err) return resp.writeHead(500);
		resp.writeHead(200);
		resp.end(data);
	});
});
app.listen(3456);


console.log('Server running at http://localhost:3456/');

var usernames = [];
var userids = {};
var user_rooms = {}; //key; user, value: room
var rooms = ["room1"];
var creator_id = {}; //key: room, value: socket id
var creator_name = {}; //key: room, value: username
var passwords = {}; //key: room, value: password
var blacklist = {}; //key: room, value: array of banned users (for that room)


// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
	// This callback runs when a new Socket.IO connection is established.
	
	function updateUserView(prev_room) {
		var start = socket.room == "room1"; //start is true if the current room is room1
        var users_in_room = [];
		var creator_in_newroom = false;
		for(var i = 0; i<usernames.length; ++i) {
			if (user_rooms[usernames[i]] == socket.room) {
                users_in_room.push(usernames[i]);
				if (usernames[i] == creator_name[socket.room]) {
                    creator_in_newroom = true;
                }
            }
		}
		io.sockets.to(socket.room).emit("users_in_room", {"users_in_room":users_in_room}); //update list of users
		if (creator_in_newroom) {
            io.sockets.to(creator_id[socket.room]).emit("is_creator",{"users_in_room":users_in_room, "banned_users":blacklist[socket.room], "room1":start});
        }
		
		var update_old_room = [];
		var creator_in_oldroom = false;
		for(var i = 0; i<usernames.length; ++i) {
			if (user_rooms[usernames[i]] == prev_room) {
                update_old_room.push(usernames[i]);
				if (usernames[i] == creator_name[prev_room]) {
                    creator_in_oldroom = true;
                }
            }
		}
		io.sockets.to(prev_room).emit("users_in_room", {"users_in_room":update_old_room}); //update list of users
		if(creator_in_oldroom){
		   io.sockets.to(creator_id[prev_room]).emit("is_creator",{"users_in_room":update_old_room, "banned_users":blacklist[prev_room], "room1":start});
		}
    }
	
	function banCheck(where, who) {
		if (blacklist[where] !== undefined && blacklist[where] !== null) { //make sure we have an array to look through
			for (var b = 0; b < blacklist[where].length; ++b) { //iterate through blacklist array of room in question
				if (blacklist[where][b] == who) {
					return true;
				} //true if the banned user is in the list
			}
		}
		return false; //only reach here if it doesn't return earlier or if the if-check fails
	}
	
	function roomSwap(whereto) {
		
		var prev_room = socket.room;
		socket.leave(socket.room);
		socket.join(whereto);
		socket.room = whereto;
		user_rooms[socket.username] = whereto;
		console.log("user " + socket.username + " has joined room: " + whereto); //debug printout

		updateUserView(prev_room);
		
		socket.emit("room_find", {room: socket.room, find:true}); //pass back to client to let user know their room was created
		io.sockets.emit("available_rooms", {avail_rooms: rooms}); //update list of available rooms
	}
	
	socket.on('message_to_server', function(data) {
		// This callback runs when the server receives a new message from the client.
		var created = false;
		
		if (socket.username == creator_name[socket.room]) { //see if the sender is the room's creator
			created = true; //if so, their name will display differently
		}
		
		console.log(socket.username + ": "+data["message"]); // log it to the Node.JS output
		console.log("message's room: " + socket.room);
		io.sockets.to(socket.room).emit("message_to_client",{message:data["message"], user:socket.username, creator: created}); // broadcast the message to other users
	});
	
	socket.on("private_message", function(data){
		var userFound = false;
		for(var i = 0; i < usernames.length; ++i) {
			if (usernames[i] == data["user"]) {
                userFound = true;
            }
		}
		
		if (userFound) {
            io.sockets.to(userids[data["user"]]).emit("private_msg_to_client", {message: data["message"], sender: socket.username});
        }
		else {
			socket.emit("user_not_found", {found: userFound});
		}
	});
	
	socket.on("added_user", function(data){ //when adding users, we go here
		var users_in_room = [];
		for (var i = 0; i < usernames.length; ++i) {
			if (usernames[i] == data["username"]) { //look through array to make sure we don't already have this user
				socket.emit("new_user",{username:data["username"], exists:true}); //if found, stop looking and don't create
				return;
			}
		}
		socket.username = data["username"];
		usernames.push(socket.username); //add user to end of array of users
		userids[socket.username] = socket.id;
		socket.join("room1"); //all users start in room1
		socket.room = "room1";
		user_rooms[socket.username] = "room1"; //add user and start room to map of users
		console.log("user_room: " + user_rooms[socket.username]);	
		console.log("user: " + socket.username); //tell us who this is, for debugging
		socket.emit("new_user", {username:data["username"], exists:false}); //info to update current user
		for(var i = 0; i<usernames.length; ++i) {
			if (user_rooms[usernames[i]] == socket.room) {
                users_in_room.push(usernames[i]);
            }
		}
		io.sockets.to(socket.room).emit("users_in_room", {"users_in_room":users_in_room}); //update list of users
		io.sockets.emit("available_rooms", {avail_rooms: rooms}); //update list of available rooms
	});
	
	socket.on("added_room", function(data){ //when adding rooms, we go here
		for (var i = 0; i < rooms.length; ++i) { 
			if (rooms[i] == data["roomname"]) { //look through array to make sure we don't already have this room
				socket.emit("room_find",{room:data["roomname"], find:"duplicate"}); //if found, stop looking and don't create
				return;
			}
		}		
		rooms.push(data["roomname"]); //if not found, add to end of array
		blacklist[rooms[rooms.length-1]] = []; //every room's blacklist should start out empty	
		creator_id[data["roomname"]] = socket.id; //keep track of who made the room
		creator_name[data["roomname"]] = socket.username;
		console.log("creator of room " + data["roomname"] + ": " + creator_name[data["roomname"]]); //debug printout
		
		roomSwap(data["roomname"]);

	});
	
	socket.on("delete_room", function(data){ //when adding rooms, we go here
	var roomToDelete = socket.room;
	
	if (roomToDelete == "room1") {
		return; //cannot delete room1!
	}
	
	var i = rooms.indexOf(roomToDelete);
		for (var j = 0; j < usernames.length; ++j) {
			if (user_rooms[usernames[j]] == roomToDelete) {
				io.sockets.to(userids[usernames[j]]).emit("change_room");
			}
			//socket.leave(roomToDelete); 
			//socket.join("room1"); //join newly created room
			//socket.room = "room1";
			//user_rooms[socket.username] = "room1"; //reset all users to start room in map of users
			//updateUserView(roomToDelete);
		}
		delete creator_id[roomToDelete]; //remove the id of the deleted room's creator from the map
		delete creator_name[roomToDelete]; //remove the name of the deleted room's creator from the map
		rooms.splice(i, 1); //remove the deleted room from the array
		delete blacklist[roomToDelete]; //remove the blacklist along with the room
		console.log("room " + roomToDelete + " has been deleted"); //debug printout
		io.sockets.emit("available_rooms", {avail_rooms: rooms}); //update list of available rooms		
	});
	
	socket.on("added_lockedroom", function(data){
		for(var i=0; i<rooms.length; ++i) {
			if (rooms[i] == data["roomname"]) { //cannot create a room that already exists
                socket.emit("room_find", {room: data["roomname"], find: "duplicate"});
				return;
            }
		}
		rooms.push(data["roomname"]);
		blacklist[rooms[rooms.length-1]] = []; //every room's blacklist should start out empty	
		creator_id[data["roomname"]] = socket.id;
		creator_name[data["roomname"]] = socket.username;
		passwords[data["roomname"]] = data["password"];
		console.log("creator of locked room " + data["roomname"] + ": " + creator_name[data["roomname"]]); //debug printout
		console.log("password of locked room " + data["roomname"] + ": " + passwords[data["roomname"]]);
		
		roomSwap(data["roomname"]);
		
		});
	
	socket.on("join_room", function(data) { 
		var i = data['i']; //because I like typing less later
		
		var found = false;
		
		if (!banCheck(rooms[i], socket.username)) {
			if (i < rooms.length && typeof rooms[i] !== 'undefined') { //make sure the index is in range and the element there exists
				var id = creator_id[rooms[i]];
				if (id == socket.id) { //if this is the creator trying to join
					roomSwap(rooms[i]); //...don't bother with a password
					return;
				}
				
				if (rooms[i] == socket.room) { //if the room to join is the current room
					socket.emit("room_find", {find:"current"}); //let the user know why their request isn't going to be carried out
					return; //don't try to join it
				}
				if (passwords[rooms[i]] !== undefined) { //basic password protection
					// need a different way to handle passwords
					socket.emit("password_needed", {room: rooms[i]});
					return;
				}
				else {
					roomSwap(rooms[i]);
					found = true; //the room we're trying to join exists! it should be impossible for this not to be true, but hey
				}
			}
		} else {
			socket.emit("banned");
		}
	});
	
	socket.on("join_lockedroom", function(data){
		
		if (!banCheck(data["room"], socket.username)) {
			if (data["password"] == passwords[data["room"]]) {
				roomSwap(data["room"]);
			} else {
				socket.emit("password_needed", {room: data["room"]});
			}
		} else {
			socket.emit("banned");
		}
	});
	
	socket.on("ban", function(data){
		var id = userids[data['user_to_ban']];
		var creator = creator_id[socket.room];
		
		if (id == creator) { 
			io.sockets.to(creator).emit("nocando"); //cannot kick/ban yourself
		} else {
			blacklist[socket.room].push(data['user_to_ban']); //blacklist user from room by adding to the current room's array of banned users
			io.sockets.to(id).emit("change_room"); //banned user must also be kicked
		}
	});

	socket.on("unban", function(data){
		var id = userids[data['user_to_unban']];
		var creator = creator_id[socket.room];
		
		var j = blacklist[socket.room].indexOf(data['user_to_unban']);
		
		if (!banCheck(socket.room, data['user_to_unban'])) { //if they aren't banned...
			io.sockets.to(creator).emit("nocando", {"why":"notbanned"}); //...can't unban them
		}
		
		if (id == creator) { 
			io.sockets.to(creator).emit("nocando", {"why":"creator"}); //cannot ban/unban yourself
		} else {
			blacklist[socket.room].splice(j,1); //remove user from room's blacklist
			io.sockets.to(id).emit("unbanned", {"room":socket.room}); //let the user know they have been unbanned
			updateUserView(socket.room);
		}
	});
	
	socket.on("kickout", function(data){
		var id = userids[data['user_to_ko']];
		var creator = creator_id[socket.room];
		
		if (id == creator) { 
			io.sockets.to(creator).emit("nocando", {"why":"creator"}); //cannot kick/ban yourself
		} else {
			io.sockets.to(id).emit("change_room");
		}
	});
	
	socket.on("room_swap_required", function() {
		roomSwap("room1");
	});
	
	socket.on("disconnect", function(){
		for (var i = 0; i < usernames.length; ++i) {
			if (usernames[i] == socket.username) {
				delete usernames[i];
				delete user_rooms[socket.username];
				delete userids[socket.username];
			}
		}
		var update_old_room = [];
		var c
ator_in_oldroom = false;
		for(var i = 0; i<usernames.length; ++i) {
			if (user_rooms[usernames[i]] == socket.room) {
                update_old_room.push(usernames[i]);
				if (usernames[i] == creator_name[socket.room]) {
                    creator_in_oldroom = true;
                }
            }
		}
		io.sockets.to(socket.room).emit("users_in_room", {"users_in_room":update_old_room}); //update list of users
		if(creator_in_oldroom){
		   io.sockets.to(creator_id[socket.room]).emit("is_creator",{"users_in_room":update_old_room, "banned_users":blacklist[socket.room], "room1":start});
		}
	});
});