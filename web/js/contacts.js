function contacts_friend_list(contacts) {
	return Array.from(contacts.friends)
}

function contacts_friendosphere(contacts) {
	let s = new Set()
	let fs = []
	for (const friend of contacts.friends.keys()) {
		fs.push(friend)
		s.add(friend)
	}
	for (const friend of contacts.friend_of_friends.keys()) {
		if (!s.has(friend))
			fs.push(friend)
	}
	return fs
}

function add_contact_if_friend(contacts, ev) {
	if (!contact_is_friend(contacts, ev.pubkey))
		return
	add_friend_contact(contacts, ev)
}

function contact_is_friend(contacts, pk) {
	return contacts.friends.has(pk)
}

function add_friend_contact(contacts, contact) {
	contacts.friends.add(contact.pubkey)
	for (const tag of contact.tags) {
		if (tag.length >= 2 && tag[0] == "p") {
			if (!contact_is_friend(contacts, tag[1]))
				contacts.friend_of_friends.add(tag[1])
		}
	}
}

function load_our_contacts(contacts, our_pubkey, ev) {
	if (ev.pubkey !== our_pubkey)
		return
	contacts.event = ev
	for (const tag of ev.tags) {
		if (tag.length > 1 && tag[0] === "p") {
			contacts.friends.add(tag[1])
		}
	}
}

