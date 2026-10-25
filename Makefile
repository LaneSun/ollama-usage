UUID = ollama-usage@lanesun.anlbrain.com
DOMAIN = $(UUID)
SCHEMA_ID = org.gnome.shell.extensions.ollama-usage
DATA_DIR = $(if $(XDG_DATA_HOME),$(XDG_DATA_HOME),$(HOME)/.local/share)
EXTENSION_DIR ?= $(DATA_DIR)/gnome-shell/extensions/$(UUID)
SOURCES = extension.js prefs.js usage.js client.js accounts.js metadata.json stylesheet.css LICENSE

.PHONY: all schemas translations install install-schema clean pot test package

all: schemas translations

# Compile GSettings schema (output goes to schemas/gschemas.compiled)
schemas:
	glib-compile-schemas --strict schemas/

# Compile translations (.po → .mo)
translations:
	mkdir -p locale/zh_CN/LC_MESSAGES
	msgfmt --check po/zh_CN.po -o locale/zh_CN/LC_MESSAGES/$(DOMAIN).mo

# Generate .pot template
pot:
	xgettext -f po/POTFILES.in -o po/$(DOMAIN).pot --from-code=UTF-8 --keyword=_ \
		--package-name="Ollama Cloud Indicator" --package-version=1

# Schemas belong to the extension, not the user's global GLib schema directory.
install-schema: schemas
	mkdir -p "$(EXTENSION_DIR)/schemas"
	install -m 644 schemas/$(SCHEMA_ID).gschema.xml schemas/gschemas.compiled "$(EXTENSION_DIR)/schemas/"

install: all install-schema
	mkdir -p "$(EXTENSION_DIR)/locale"
	install -m 644 $(SOURCES) "$(EXTENSION_DIR)/"
	cp -r locale/. "$(EXTENSION_DIR)/locale/"

test: all
	node --check extension.js
	node --check prefs.js
	node --test tests/*.test.mjs
	gjs -m tests/client.test.js

package:
	./package.sh

clean:
	rm -f schemas/gschemas.compiled
	rm -rf locale/
