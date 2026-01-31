#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { CliApp } from './ui/CliApp.jsx';
const argv = process.argv.slice(2);

render(<CliApp argv={argv} />);
