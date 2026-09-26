#!/usr/bin/env node
/**
 * The installed entry point.
 *
 * Two reasons this is plain JS rather than the .mts itself. Node refuses to
 * strip types from anything under node_modules at all, so a published
 * TypeScript source cannot run in a dependency; and npm links the bin as an
 * extensionless `pai`, which Node would not recognise as TypeScript
 * even if it would. So `npm run build` compiles the source to dist/ and this
 * file, which never needs compiling, is what npm points at.
 */
import { main } from './dist/pai.mjs';

await main();
