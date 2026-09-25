# Public development and release commands for Graupel.
#
# Examples:
#   make -f Makefile.public setup       Install Python and React dependencies
#   make -f Makefile.public react       Build only the React frontend
#   make -f Makefile.public package     Build React, then wheel and sdist
#   make -f Makefile.public run         Run the module without package artifacts
#   make -f Makefile.public run-fresh   Build React, then run the module

.DEFAULT_GOAL := help

UV ?= uv
PNPM ?= pnpm
PYTHON ?= python
REACT_DIR := react
REACT_INSTALL_STAMP := $(REACT_DIR)/node_modules/.modules.yaml

.PHONY: help setup python-deps react-deps react react-build package build run run-fresh test

help:
	@printf '%s\n' \
		'Graupel public build commands:' \
		'  setup       Install Python and React dependencies' \
		'  react       Build only the React production frontend' \
		'  package     Build React, then create wheel and sdist with uv' \
		'  run         Run python -m graupel without creating package files' \
		'  run-fresh   Build React first, then run without package files' \
		'  test        Run Python and React test suites'

setup: python-deps react-deps

python-deps:
	$(UV) sync

react-deps: $(REACT_INSTALL_STAMP)

$(REACT_INSTALL_STAMP): $(REACT_DIR)/package.json $(REACT_DIR)/pnpm-lock.yaml
	$(PNPM) --dir $(REACT_DIR) install --frozen-lockfile

react react-build: react-deps
	$(PNPM) --dir $(REACT_DIR) run build

package build: react
	$(UV) build

run:
	$(UV) run $(PYTHON) -m graupel

run-fresh: react
	$(UV) run $(PYTHON) -m graupel

test: react-deps
	$(UV) run pytest
	$(PNPM) --dir $(REACT_DIR) test
