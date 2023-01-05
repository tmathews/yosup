const PROFILE_FIELDS = [
	'name', 
	'picture', 
	'nip05', 
	'about',
];

function open_profile(pubkey) {
	view_timeline_apply_mode(DAMUS, VM_USER, { pubkey });
	view_update_profile(DAMUS, pubkey);
}

function init_profile() {
	const el = find_node("#profile-info");
	const el_pfp = find_node("[role='profile-image']", el);
	el_pfp.addEventListener("error", onerror_pfp);
	el_pfp.src = IMG_NO_USER;
	find_node("[role='message-user']", el)
		.addEventListener("click", onclick_message_user);
	find_node("[role='edit-profile']", el)
		.addEventListener("click", onclick_edit_profile);
	find_node("[role='copy-pk']", el)
		.addEventListener("click", onclick_copy_pubkey);
	find_node("[role='follow-user']", el)
		.addEventListener("click", onclick_follow_user);
}

function onclick_message_user(ev) {
	const pubkey = ev.target.dataset.pubkey;
	view_timeline_apply_mode(DAMUS, VM_DM_THREAD, { pubkey });
}

/* onclick_copy_pubkey writes the element's dataset.pk field to the users OS'
 * clipboard. No we don't use fallback APIs, use a recent browser.
 */
function onclick_copy_pubkey(ev) {
	const el = ev.target;
	navigator.clipboard.writeText(el.dataset.pk);
	// TODO show toast
}

/* onclick_follow_user sends the event to the relay to subscribe the active user
 * to the target public key of the element's dataset.pk field.
 */
function onclick_follow_user(ev) {
	const el = ev.target;
	const { contacts } = DAMUS;
	const pubkey = el.dataset.pk;
	const is_friend = contacts.friends.has(pubkey);
	if (is_friend) {
		contacts.friends.delete(pubkey);
	} else {
		contacts.friends.add(pubkey);
	}
	el.innerText = is_friend ? "Follow" : "Unfollow";
	contacts_save(contacts);
	if (window.confirm("Contacts are saved locally. Do you want to sync you contacts with all relays?")) {
		update_contacts();
	}
}

function view_update_profile(model, pubkey) {
	const profile = model_get_profile(model, pubkey);
	const el = find_node("#profile-info");

	const name = fmt_name(profile);
	find_node("[role='profile-image']", el).src = get_profile_pic(profile); 
	find_nodes("[role='profile-name']", el).forEach(el => {
		el.innerText = name;
	});

	const el_nip5 = find_node("[role='profile-nip5']", el)
	el_nip5.innerText = profile.data.nip05;
	el_nip5.classList.toggle("hide", !profile.data.nip05);
	
	const el_desc = find_node("[role='profile-desc']", el)
	el_desc.innerHTML = newlines_to_br(linkify(profile.data.about));
	el_desc.classList.toggle("hide", !profile.data.about);
	
	find_node("button[role='copy-pk']", el).dataset.pk = pubkey;
	find_node("button[role='edit-profile']", el)
		.classList.toggle("hide", pubkey != model.pubkey);
	
	const btn_follow = find_node("button[role='follow-user']", el);
	btn_follow.dataset.pk = pubkey;
	btn_follow.innerText = contact_is_friend(model.contacts, pubkey) ? "Unfollow" : "Follow";
	btn_follow.classList.toggle("hide", pubkey == model.pubkey);

	const btn_message = find_node("button[role='message-user']", el);
	btn_message.dataset.pubkey = pubkey;
}

function onclick_edit_profile() {
	const p = model_get_profile(DAMUS, DAMUS.pubkey);
	const el = find_node("#profile-editor");
	el.classList.remove("closed");
	for (const key of PROFILE_FIELDS) {
		find_node(`[name='${key}']`, el).value = p.data[key];
	}
}

function click_update_profile() {
	const el = find_node("#profile-editor");
	const btn = find_node("button.action", el);
	const p = Object.assign({}, model_get_profile(DAMUS, DAMUS.pubkey).data, {
		name: find_node("input[name='name']", el).value,
		picture: find_node("input[name='picture']", el).value,
		nip05: find_node("input[name='nip05']", el).value,
		about: find_node("textarea[name='about']", el).value,
	});
	update_profile(p);
	close_modal(el);
	// TODO show toast that say's "broadcasted!"
}

