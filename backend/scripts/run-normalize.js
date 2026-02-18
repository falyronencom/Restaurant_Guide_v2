/**
 * Normalize English cuisine/category values to Russian in the database.
 *
 * Run from the backend folder:
 *   node scripts/run-normalize.js
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'restaurant_guide_belarus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// English → Russian mappings
const cuisineMappings = [
  ['belarusian', 'Народная'],
  ['national', 'Народная'],
  ['european', 'Европейская'],
  ['italian', 'Итальянская'],
  ['asian', 'Азиатская'],
  ['american', 'Американская'],
  ['georgian', 'Грузинская'],
  ['japanese', 'Японская'],
  ['vegetarian', 'Вегетарианская'],
  ['mixed', 'Смешанная'],
  ['international', 'Смешанная'],
  ['continental', 'Континентальная'],
  ['indian', 'Индийская'],
  ['mediterranean', 'Средиземноморская'],
  ['fusion', 'Авторская'],
  ['author', 'Авторская'],
];

const categoryMappings = [
  ['restaurant', 'Ресторан'],
  ['cafe', 'Кофейня'],
  ['bar', 'Бар'],
  ['fast_food', 'Фаст-фуд'],
  ['pizzeria', 'Пиццерия'],
  ['bakery', 'Пекарня'],
  ['pub', 'Паб'],
  ['canteen', 'Столовая'],
  ['hookah_lounge', 'Кальянная'],
  ['hookah_bar', 'Кальянная'],
  ['bowling', 'Боулинг'],
  ['karaoke', 'Караоке'],
  ['billiards', 'Бильярд'],
  ['nightclub', 'Клуб'],
  ['confectionery', 'Кондитерская'],
];

async function run() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('=== Normalizing cuisines ===');
    let totalCuisines = 0;
    for (const [eng, rus] of cuisineMappings) {
      const result = await client.query(
        `UPDATE establishments SET cuisines = array_replace(cuisines, $1, $2) WHERE $1 = ANY(cuisines)`,
        [eng, rus]
      );
      if (result.rowCount > 0) {
        console.log(`  ${eng} → ${rus}: ${result.rowCount} rows`);
        totalCuisines += result.rowCount;
      }
    }

    console.log(`\n=== Normalizing categories ===`);
    let totalCategories = 0;
    for (const [eng, rus] of categoryMappings) {
      const result = await client.query(
        `UPDATE establishments SET categories = array_replace(categories, $1, $2) WHERE $1 = ANY(categories)`,
        [eng, rus]
      );
      if (result.rowCount > 0) {
        console.log(`  ${eng} → ${rus}: ${result.rowCount} rows`);
        totalCategories += result.rowCount;
      }
    }

    await client.query('COMMIT');

    console.log(`\n=== Done ===`);
    console.log(`Cuisines updated: ${totalCuisines} rows`);
    console.log(`Categories updated: ${totalCategories} rows`);

    // Verification
    const check = await client.query(`
      SELECT unnest(cuisines) AS val, count(*) AS cnt
      FROM establishments
      GROUP BY val
      ORDER BY cnt DESC
    `);
    console.log(`\n=== Current cuisine values in DB ===`);
    for (const row of check.rows) {
      console.log(`  ${row.val}: ${row.cnt}`);
    }

    const checkCat = await client.query(`
      SELECT unnest(categories) AS val, count(*) AS cnt
      FROM establishments
      GROUP BY val
      ORDER BY cnt DESC
    `);
    console.log(`\n=== Current category values in DB ===`);
    for (const row of checkCat.rows) {
      console.log(`  ${row.val}: ${row.cnt}`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error — rolled back:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
