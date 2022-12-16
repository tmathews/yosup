function linkify(text, show_media) {
	return text.replace(URL_REGEX, function(match, p1, p2, p3) {
		const url = p2+p3;
		let parsed;
		try {
			parsed = new URL(url)
		} catch (err) {
			return match;
		}
		let html;
		if (show_media && is_img_url(parsed.pathname)) {
			html = `
			<img class="inline-img clickable" src="${url}" onclick="open_media_preview('${url}', 'image')"/>
			`;
		} else if (show_media && is_video_url(parsed.pathname)) {
			html = `
			<video controls class="inline-img" />
			  <source src="${url}">
			</video>
			`;
		} else {
			html = `<a target="_blank" rel="noopener noreferrer" href="${url}">${url}</a>`;
		}
		return p1+html;
	})
}

function format_content(ev, show_media) {
	if (ev.kind === 7) {
		if (ev.content === "" || ev.content === "+")
			return "❤️"
		return sanitize(ev.content.trim())
	}

	const content = ev.content.trim()
	const body = convert_quote_blocks(content, show_media)

	let cw = get_content_warning(ev.tags)
	if (cw !== null) {
		let cwHTML = "Content Warning"
		if (cw === "") {
			cwHTML += "."
		} else {
			cwHTML += `: "<span>${cw}</span>".`
		}
		const open = !!DAMUS.cw_open[ev.id]? "open" : ""
		return `
		<details ontoggle="toggle_content_warning(this)" class="cw" id="cw_${ev.id}" ${open}>
		  <summary class="event-message">${cwHTML}</summary>
		  ${body}
		</details>
		`
	}

	return body
}

function convert_quote_blocks(content, show_media)
{
	const split = content.split("\n")
	let blockin = false
	return split.reduce((str, line) => {
		if (line !== "" && line[0] === '>') {
			if (!blockin) {
				str += "<span class='quote'>"
				blockin = true
			}
			str += linkify(sanitize(line.slice(1)), show_media)
		} else {
			if (blockin) {
				blockin = false
				str += "</span>"
			}
			str += linkify(sanitize(line), show_media)
		}
		return str + "<br/>"
	}, "")
}

