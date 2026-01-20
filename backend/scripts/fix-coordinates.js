import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/restaurant_guide_belarus'
});

async function fixCoordinates() {
  const updates = [
    { name: 'Кафе Минск', lat: 53.8964, lon: 27.5515 },
    { name: 'Ресторан Традиция', lat: 53.8982, lon: 27.5576 },
    { name: 'Пиццерия Итальяно', lat: 53.9022, lon: 27.5498 },
    { name: 'Бар Central', lat: 53.9058, lon: 27.5589 },
    { name: 'Суши Бар Токио', lat: 53.9382, lon: 27.4818 }
  ];

  console.log('Updating coordinates...\n');

  for (const u of updates) {
    const result = await pool.query(
      'UPDATE establishments SET latitude = $1, longitude = $2 WHERE name = $3 RETURNING name',
      [u.lat, u.lon, u.name]
    );
    if (result.rowCount > 0) {
      console.log(`✓ ${u.name} -> ${u.lat}, ${u.lon}`);
    } else {
      console.log(`✗ ${u.name} - not found`);
    }
  }

  console.log('\n--- Verification ---');
  const all = await pool.query('SELECT name, address, latitude, longitude FROM establishments ORDER BY name');
  all.rows.forEach(r => {
    console.log(`${r.name}`);
    console.log(`  Address: ${r.address}`);
    console.log(`  Coords: ${r.latitude}, ${r.longitude}`);
  });

  await pool.end();
}

fixCoordinates().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
