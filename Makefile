
all: fake
	@echo "you don't need to build anything."

tags: fake
	find js -name '*.js' | xargs ctags > "$@"

emojiregex: fake
	@curl -sL 'https://raw.githubusercontent.com/mathiasbynens/emoji-test-regex-pattern/main/dist/latest/javascript.txt'

.PHONY: fake
