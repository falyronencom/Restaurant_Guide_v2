/**
 * Partner Documents Model
 *
 * Database access methods for the partner_documents table.
 * Stores legal entity information and verification documents for partner establishments.
 *
 * Architecture note: Thin data access layer. Business logic lives in the service layer.
 * Follows patterns established in mediaModel.js and reviewModel.js.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Create a partner document record
 *
 * @param {Object} data
 * @param {string} data.partner_id - UUID of the partner (user)
 * @param {string} data.establishment_id - UUID of the establishment
 * @param {string} data.document_type - Document type (e.g. 'registration_certificate')
 * @param {string} data.document_url - URL of the uploaded document
 * @param {string} data.company_name - Legal entity name
 * @param {string} data.tax_id - UNP (tax identification number)
 * @param {string} data.contact_person - Contact person
 * @param {string} data.contact_email - Contact email
 * @returns {Promise<Object>} Created record
 */
export const createPartnerDocument = async (data) => {
  const {
    partner_id,
    establishment_id,
    document_type = 'registration_certificate',
    document_url = '',
    company_name,
    tax_id,
    contact_person,
    contact_email,
  } = data;

  const query = `
    INSERT INTO partner_documents (
      partner_id,
      establishment_id,
      document_type,
      document_url,
      company_name,
      tax_id,
      contact_person,
      contact_email
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const values = [
    partner_id,
    establishment_id,
    document_type,
    document_url,
    company_name || null,
    tax_id || null,
    contact_person || null,
    contact_email || null,
  ];

  try {
    const result = await pool.query(query, values);

    logger.info('Partner document created', {
      id: result.rows[0].id,
      partnerId: partner_id,
      establishmentId: establishment_id,
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error creating partner document', {
      error: error.message,
      partnerId: partner_id,
      establishmentId: establishment_id,
    });
    throw error;
  }
};

/**
 * Find partner document by establishment ID
 *
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object|null>} Document record or null
 */
export const findByEstablishmentId = async (establishmentId) => {
  const query = `
    SELECT *
    FROM partner_documents
    WHERE establishment_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `;

  try {
    const result = await pool.query(query, [establishmentId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    logger.error('Error finding partner document by establishment', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Update partner document by establishment ID
 *
 * Updates only the provided fields. Used for syncing legal info on establishment edits.
 *
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated record or null if not found
 */
export const updateByEstablishmentId = async (establishmentId, updates) => {
  const fields = [];
  const values = [];
  let paramCount = 1;

  const allowedFields = ['company_name', 'tax_id', 'contact_person', 'contact_email', 'document_type', 'document_url'];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = $${paramCount}`);
      values.push(updates[field]);
      paramCount++;
    }
  }

  if (fields.length === 0) {
    return null;
  }

  values.push(establishmentId);

  const query = `
    UPDATE partner_documents
    SET ${fields.join(', ')}
    WHERE establishment_id = $${paramCount}
    RETURNING *
  `;

  try {
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return null;
    }

    logger.info('Partner document updated', {
      establishmentId,
      updatedFields: Object.keys(updates),
    });

    return result.rows[0];
  } catch (error) {
    logger.error('Error updating partner document', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};
