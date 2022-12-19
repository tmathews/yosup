// TODO track friend sphere another way by using graph nodes

function contact_is_friend(contacts, pk) {
	return contacts.friends.has(pk)
}

function contacts_process_event(contacts, our_pubkey, ev) {
	if (ev.pubkey !== our_pubkey)
		return;
	contacts.event = ev
	for (const tag of ev.tags) {
		if (tag.length > 1 && tag[0] === "p") {
			contacts.friends.add(tag[1])
		}
	}
}
	
/* contacts_push_relay sends your contact list to the desired relay.
 */
function contacts_push_relay(contacts, relay) {
	log_warn("contacts_push_relay not implemented");
}

/* contacts_save commits the contacts data to storage.
 */
function contacts_save(contacts) {
	log_warn("contacts_save not implemented");
}
