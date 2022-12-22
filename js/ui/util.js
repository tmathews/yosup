/* This file contains utility functions related to UI manipulation. Some code
 * may be specific to areas of the UI and others are more utility based. As
 * this file grows specific UI area code should be migrated to its own file.
 */

/* toggle_cw changes the active stage of the Content Warning for a post. It is
 * relative to the element that is pressed.
 */
function toggle_cw(el) {
	el.classList.toggle("active");
    const isOn = el.classList.contains("active");
	const input = el.parentElement.querySelector("input.cw");
	input.classList.toggle("hide", !isOn);
}

/* toggle_gnav hides or shows the global navigation's additional buttons based
 * on its opened state.
 */
function toggle_gnav(el) {
	el.parentElement.classList.toggle("open");
}

function close_gnav() {
	find_node("#gnav").classList.remove("open");
}

/* post_input_changed checks the content of the textarea and updates the size
 * of it's element. Additionally I will toggle the enabled state of the sending
 * button.
 */
function post_input_changed(el) {
	el.style.height = `0px`;
	el.style.height = `${el.scrollHeight}px`;
	let btn = el.parentElement.querySelector("button[role=send]");
	if (btn) btn.disabled = el.value === "";
}

/* init_message_textareas finds all message textareas and updates their initial
 * height based on their content (0). This is so there is no jaring affect when
 * the page loads.
 */
function init_message_textareas() {
	const els = document.querySelectorAll(".post-input");
	for (const el of els) {
		post_input_changed(el);
	}
}

// update_notification_markers will find all markers and hide or show them
// based on the passed in state of 'active'.
function update_notification_markers(active) {
	let els = document.querySelectorAll(".new-notifications")
	for (const el of els) {
		el.classList.toggle("hide", !active)
	}
}

/* show_profile updates the current view to the profile display and updates the
 * information to the relevant profile based on the public key passed.
 * TODO handle async waiting for relay not yet connected
 */
function show_profile(pk) {
	switch_view("profile");
	const profile = DAMUS.profiles[pk];
	const el = find_node("#profile-view");
	// TODO show loading indicator then render
	
	find_node("[role='profile-image']", el).src = get_picture(pk, profile); 
	find_nodes("[role='profile-name']", el).forEach(el => {
		el.innerText = fmt_profile_name(profile, fmt_pubkey(pk));
	});
	
	const el_nip5 = find_node("[role='profile-nip5']", el)
	el_nip5.innerText = profile.nip05;
	el_nip5.classList.toggle("hide", !profile.nip05);
	
	const el_desc = find_node("[role='profile-desc']", el)
	el_desc.innerHTML = newlines_to_br(profile.about);
	el_desc.classList.toggle("hide", !profile.about);
	
	find_node("button[role='copy-pk']", el).dataset.pk = pk;
	
	const btn_follow = find_node("button[role='follow-user']", el)
	btn_follow.dataset.pk = pk;
	// TODO check follow status
	btn_follow.innerText = 1 == 1 ? "Follow" : "Unfollow";
	btn_follow.classList.toggle("hide", pk == DAMUS.pubkey);
}

/* newlines_to_br takes a string and converts all newlines to HTML 'br' tags.
 */
function newlines_to_br(str="") {
	return str.split("\n").reduce((acc, part, index) => {
		return acc + part + "<br/>";
	}, "");
}

/* click_copy_pk writes the element's dataset.pk field to the users OS'
 * clipboard. No we don't use fallback APIs, use a recent browser.
 */
function click_copy_pk(el) {
	// TODO show toast
	navigator.clipboard.writeText(el.dataset.pk);
}

/* click_follow_user sends the event to the relay to subscribe the active user
 * to the target public key of the element's dataset.pk field.
 */
function click_toggle_follow_user(el) {
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
}

function show_new() {
	view_timeline_show_new(DAMUS);
}

/* click_event opens the thread view from the element's specified element id
 * "dataset.eid".
 */
function click_event(el) {
	console.info(`thread to open: ${el.dataset.eid}`);
	switch_view("thread");
}

function click_toggle_like(el) {
	// Disable the button to prevent multiple presses
	el.disabled = true;
	if (el.dataset.liked == "yes") {
		delete_post(el.dataset.reactionId);
		return;
	}
	send_reply(R_HEART, el.dataset.reactingTo);
}

/* open_media_preview presents a modal to display an image via "url".
 */
function open_media_preview(url, type) {
	const el = find_node("#media-preview");
	el.classList.remove("closed");
	find_node("img", el).src = url;
	// TODO handle different medias such as audio and video
	// TODO add loading state & error checking
}

/* close_media_preview closes any present media modal.
 */
function close_media_preview() {
	find_node("#media-preview").classList.add("closed");
}

function close_reply() {
	const modal = document.querySelector("#reply-modal")
	modal.classList.add("closed");
}

async function press_logout() {
	if (confirm("Are you sure you want to sign out?")) {
		localStorage.clear();
		await dbclear();
		window.location.reload();
	}
}

function delete_post_confirm(evid) {
	if (!confirm("Are you sure you want to delete this post?"))
		return;
	const reason = (prompt("Why you are deleting this? Leave empty to not specify. Type CANCEL to cancel.") || "").trim()
	if (reason.toLowerCase() === "cancel")
		return;
	delete_post(evid, reason)
}

async function do_send_reply() {
	const modal = document.querySelector("#reply-modal");
	const replying_to = modal.querySelector("#replying-to");
	const evid = replying_to.dataset.evid;
	const reply_content_el = document.querySelector("#reply-content");
	const content = reply_content_el.value;
	await send_reply(content, evid);
	reply_content_el.value = "";
	close_reply();
}

function reply_to(evid) {
	const ev = DAMUS.all_events[evid]
	const modal = document.querySelector("#reply-modal")
	const replybox = modal.querySelector("#reply-content")
	const replying_to = modal.querySelector("#replying-to")
	replying_to.dataset.evid = evid
	replying_to.innerHTML = render_event_nointeract(DAMUS, ev, {
		is_composing: true, 
		nobar: true
	});
	modal.classList.remove("closed")
	replybox.focus()
}

function redraw_my_pfp(model, force = false) {
	const p = model.profiles[model.pubkey]
	if (!p) return;
	const html = render_pfp(model.pubkey, p);
	const el = document.querySelector(".my-userpic");
	if (!force && el.dataset.loaded) return;
	el.dataset.loaded = true;
	el.innerHTML = html;
}

function update_favicon(path)
{
	let link = document.querySelector("link[rel~='icon']");
	const head = document.getElementsByTagName('head')[0]

	if (!link) {
		link = document.createElement('link');
		link.rel = 'icon';
		head.appendChild(link);
	}

	link.href = path;
}

// update_title updates the document title & visual indicators based on if the
// number of notifications that are unseen by the user.
function update_title(model) {
	// TODO rename update_title to update_notification_state or similar
	// TODO only clear notifications once they have seen all targeted events
	if (document.visibilityState === 'visible') {
		model.notifications = 0
	}

	const num = model.notifications
	const has_notes = num !== 0
	document.title = has_notes ? `(${num}) Damus` : "Damus";
	update_favicon(has_notes ? "img/damus_notif.svg" : "img/damus.svg");
	update_notification_markers(has_notes)
}

async function get_pubkey(use_prompt=true) {
	let pubkey = get_local_state('pubkey')
	if (pubkey)
		return pubkey
	if (window.nostr && window.nostr.getPublicKey) {
		log_debug("calling window.nostr.getPublicKey()...")
		const pubkey = await window.nostr.getPublicKey()
		log_debug("got %s pubkey from nos2x", pubkey)
		return await handle_pubkey(pubkey)
	}
	if (!use_prompt)
		return;
	pubkey = prompt("Enter Nostr ID (eg: jb55@jb55.com) or public key (hex or npub).")
	if (!pubkey.trim())
		return;
	return await handle_pubkey(pubkey)
}

function get_privkey() {
	let privkey = get_local_state('privkey')
	if (privkey)
		return privkey
	if (!privkey)
		privkey = prompt("Enter private key")
	if (!privkey)
		throw new Error("can't get privkey")
	if (privkey[0] === "n") {
		privkey = bech32_decode(privkey)
	}
	set_local_state('privkey', privkey)
	return privkey
}

function open_thread(thread_id) {
	view_timeline_apply_mode(DAMUS, VM_THREAD, { thread_id });
}

function open_profile(pubkey) {
	view_timeline_apply_mode(DAMUS, VM_USER, { pubkey });
	view_update_profile(DAMUS, pubkey);
}

function open_faqs() {
	find_node("#faqs").classList.remove("closed");
}

function close_modal(el) {
	while (el.parentElement) {
		if (el.classList.contains("modal")) {
			el.classList.add("closed");
			break;
		}
		el = el.parentElement;
	}
}

function view_update_profile(model, pubkey) {
	const profile = model.profiles[pubkey] || {};
	const el = find_node("[role='profile-info']");

	const name = fmt_profile_name(profile, fmt_pubkey(pubkey));
	find_node("#view header > label").innerText = name;
	find_node("[role='profile-image']", el).src = get_picture(pubkey, profile); 
	find_nodes("[role='profile-name']", el).forEach(el => {
		el.innerText = name;
	});

	const el_nip5 = find_node("[role='profile-nip5']", el)
	el_nip5.innerText = profile.nip05;
	el_nip5.classList.toggle("hide", !profile.nip05);
	
	const el_desc = find_node("[role='profile-desc']", el)
	el_desc.innerHTML = newlines_to_br(linkify(profile.about));
	el_desc.classList.toggle("hide", !profile.about);
	
	find_node("button[role='copy-pk']", el).dataset.pk = pubkey;
	
	const btn_follow = find_node("button[role='follow-user']", el)
	btn_follow.dataset.pk = pubkey;
	// TODO check follow status
	btn_follow.innerText = contact_is_friend(DAMUS.contacts, pubkey) ? "Unfollow" : "Follow";
	btn_follow.classList.toggle("hide", pubkey == DAMUS.pubkey);
}
