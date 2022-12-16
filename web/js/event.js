/* EVENT */

/* event_refs_pubkey checks if the event (ev) is directed at the public key 
 * (pubkey) by checking its type, tags, and key.
 */
function event_refs_pubkey(ev, pubkey) {
	if (!(ev.kind === 1 || ev.kind === 42))
		return false
	if (ev.pubkey === pubkey)
		return false
	for (const tag of ev.tags) {
		if (tag.length >= 2 && tag[0] === "p" && tag[1] === pubkey)
			return true
	}
	return false
}

function event_calculate_pow(ev) {
	const id_bits = leading_zero_bits(ev.id)
	for (const tag of ev.tags) {
		if (tag.length >= 3 && tag[0] === "nonce") {
			const target = +tag[2]
			if (isNaN(target))
				return 0

			// if our nonce target is smaller than the difficulty,
			// then we use the nonce target as the actual difficulty
			return min(target, id_bits)
		}
	}

	// not a valid pow if we don't have a difficulty target
	return 0
}

/* event_can_reply returns a boolean value based on if you can "reply" to the
 * event in the manner of a chat.
 */
function event_can_reply(ev) {
	return ev.kind === 1 || ev.kind === 42
}

/* event_is_timeline returns a boolean based on if the event should be rendered
 * in a GUI
 */
function event_is_timeline(ev) {
	return ev.kind === 1 || ev.kind === 42 || ev.kind === 6
}	

function event_get_tag_refs(tags) {
	let ids = []
	let pubkeys = []
	let root, reply
	let i = 0
	for (const tag of tags) {
		if (tag.length >= 4 && tag[0] == "e") {
			ids.push(tag[1])
			if (tag[3] === "root") {
				root = tag[1]
			} else if (tag[3] === "reply") {
				reply = tag[1]
			}
		} else if (tag.length >= 2 && tag[0] == "e") {
			ids.push(tag[1])
		} else if (tag.length >= 2 && tag[0] == "p") {
			pubkeys.push(tag[1])
		}
		i++
	}
	if (!(root && reply) && ids.length > 0) {
		if (ids.length === 1)
			return {root: ids[0], reply: ids[0], pubkeys}
		else if (ids.length >= 2)
			return {root: ids[0], reply: ids[1], pubkeys}
		return {pubkeys}
	}
	return {root, reply, pubkeys}
}

function passes_spam_filter(contacts, ev, pow) {
	log_warn("passes_spam_filter deprecated, use event_is_spam");
	return !event_is_spam(ev, contacts, pow);
}

function event_is_spam(ev, contacts, pow) {
	if (contacts.friend_of_friends.has(ev.pubkey))
		return true
	return ev.pow >= pow
}

function event_cmp_created(a, b) {
	if (a.created_at > b.created_at)
		return 1;
	if (a.created_at < b.created_at)
		return -1;
	return 0;
}

