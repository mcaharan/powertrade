const db = require('../src/db');
const fs = require('fs');
const path = require('path');

async function clear() {
  try {
    console.log('Clearing orders...');
    await db.query('DELETE FROM orders');
    console.log('Clearing trades...');
    await db.query('DELETE FROM trades');
    console.log('Clearing portfolio...');
    await db.query('DELETE FROM portfolio');

    const cachePath = path.resolve(__dirname, '..', 'nfo_cache.json');
    try {
      fs.writeFileSync(cachePath, JSON.stringify({}), 'utf8');
      console.log('Reset nfo_cache.json');
    } catch (err) {
      console.warn('Could not reset nfo_cache.json:', err.message);
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error clearing data:', err.message || err);
    process.exit(2);
  }
}

clear();
