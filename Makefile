UUID = ollama-usage@lanesun.anlbrain.com
DOMAIN = $(UUID)
SCHEMA_ID = org.gnome.shell.extensions.ollama-usage

.PHONY: all schemas translations install-schema clean pot

all: schemas translations

# Compile GSettings schema (output goes to schemas/gschemas.compiled)
schemas:
	glib-compile-schemas schemas/

# Compile translations (.po → .mo)
translations:
	mkdir -p locale/zh_CN/LC_MESSAGES
	msgfmt po/zh_CN.po -o locale/zh_CN/LC_MESSAGES/$(DOMAIN).mo

# Generate .pot template
pot:
	xgettext -f po/POTFILES.in -o po/$(DOMAIN).pot --from-code=UTF-8 --keyword=_ \
		--package-name="Ollama Cloud Indicator" --package-version=1

# Install schema to user glib schema dir (needed for prefs to find it)
install-schema: schemas
	glib-compile-schemas ~/.local/share/glib-2.0/schemas/

clean:
	rm -f schemas/gschemas.compiled
	rm -rf locale/