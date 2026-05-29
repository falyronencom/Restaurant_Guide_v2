// Stub for `server-only` / `client-only` marker packages under jsdom. These
// packages throw by design outside an RSC bundler; mapping them to an empty
// module lets server-side API modules be imported in unit tests.
module.exports = {};
