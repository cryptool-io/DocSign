const path = require('path');
const dotenv = require('dotenv');

/**
 * Load env once, .env.local taking precedence over the committed .env template
 * (the AMT convention). Requiring this module anywhere is safe and idempotent —
 * dotenv won't overwrite variables already present in process.env.
 */
const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

module.exports = process.env;
