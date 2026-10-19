/* eslint-env jest */
/**
 * projectForViewer — the one layer under every panel answer to a viewer
 * (pack 2, point 3). The route-level sentinel
 * (integration/admin-viewer-sentinel.test.js) proves no route leaks; this file
 * pins the function's own contract: what is withheld, what is kept, and that
 * the shape the panel parses survives.
 */

import { jest } from '@jest/globals';
import {
  projectForViewer,
  viewerResponseProjection,
} from '../../projections/viewerProjection.js';

describe('projectForViewer', () => {
  test('withholds personal keys at any depth; keeps the key, nulls the value', () => {
    const body = {
      success: true,
      data: [
        { id: 'a', author_email: 'a@x.by', author_name: 'Аня', rating: 5 },
        { id: 'b', entity_context: { reviewer_name: 'Борис', rating: 2 }, admin_email: 'm@x.by' },
      ],
      meta: { total: 2 },
    };

    expect(projectForViewer(body)).toEqual({
      success: true,
      data: [
        // author_name stays: a visible review is signed on the public card;
        // the service, not the layer, withholds it for a hidden one.
        { id: 'a', author_email: null, author_name: 'Аня', rating: 5 },
        { id: 'b', entity_context: { reviewer_name: null, rating: 2 }, admin_email: null },
      ],
      meta: { total: 2 },
    });
  });

  // Every key of the specification of point 3 — the same literal list the
  // route sentinel keeps (admin-viewer-sentinel.test.js, WITHHELD_KEYS), not
  // imported from the layer. Most of them are already null upstream on every
  // route, so here the layer is the only witness that it withholds them.
  test.each([
    'author_email', 'reviewer_name', 'admin_name', 'admin_email',
    'contact_person', 'contact_email', 'contact_phone', 'registration_doc_url', 'document_url',
    'partner_name', 'partner_email', 'partner_phone',
    'user_name', 'user_email', 'user_phone', 'owner_name', 'owner_email', 'owner_phone',
    'ip_address', 'user_agent',
    'hidden_review_ids', 'restored_review_ids',
  ])('withholds %s, nested and at the top', (key) => {
    const out = projectForViewer({ data: [{ id: 'x', [key]: 'personal', inner: { [key]: ['personal'] } }] });

    expect(out).toEqual({ data: [{ id: 'x', [key]: null, inner: { [key]: null } }] });
  });

  test('a person object keeps its id and time, loses name and contacts', () => {
    const at = new Date('2026-10-12T10:00:00Z');
    const out = projectForViewer({
      data: { suspended_by: { id: 'u1', name: 'Модератор', email: 'm@x.by', phone: '+375291112233', at } },
    });

    expect(out.data.suspended_by).toEqual({ id: 'u1', name: null, email: null, phone: null, at });
    expect(out.data.suspended_by.at).toBeInstanceOf(Date);
  });

  test('business contacts of the establishment stay: phone, e-mail, company', () => {
    const card = {
      phone: '+375 17 000-00-00',
      email: 'info@cafe.by',
      legal_name: 'ООО «Кафе»',
      contact_person: 'Иван',
      contact_email: 'ivan@cafe.by',
      registration_doc_url: 'https://x/doc.pdf',
    };

    expect(projectForViewer(card)).toEqual({
      phone: '+375 17 000-00-00',
      email: 'info@cafe.by',
      legal_name: 'ООО «Кафе»',
      contact_person: null,
      contact_email: null,
      registration_doc_url: null,
    });
  });

  test('moderator notes are opaque: their keys are field names, not people (Phase 3.5 review)', () => {
    // moderation_notes maps a field of the card to the moderator's comment on
    // it — «contact_person: укажите ФИО» is a remark about the field, not the
    // person. Withholding it would silently drop a reason for rejection.
    const notes = {
      contact_person: 'Укажите ФИО полностью',
      contact_email: 'Почта не отвечает',
      name: 'Уточните название',
    };
    const out = projectForViewer({
      data: { moderation_notes: notes, new_data: { status: 'rejected', moderation_notes: notes } },
    });

    expect(out.data.moderation_notes).toEqual(notes);
    expect(out.data.new_data.moderation_notes).toEqual(notes);
  });

  test('does not modify its argument', () => {
    const body = { data: [{ admin_email: 'm@x.by' }] };
    projectForViewer(body);
    expect(body.data[0].admin_email).toBe('m@x.by');
  });

  test('scalars, null and arrays of scalars pass through', () => {
    expect(projectForViewer(null)).toBeNull();
    expect(projectForViewer('text')).toBe('text');
    expect(projectForViewer([1, 'a', null])).toEqual([1, 'a', null]);
  });
});

describe('viewerResponseProjection middleware', () => {
  const run = (role, body) => {
    let sent;
    const res = { locals: {}, json: (value) => { sent = value; return res; } };
    const next = jest.fn();
    viewerResponseProjection({ user: { role } }, res, next);
    res.json(body);
    return { sent, next };
  };

  test('projects the answer of a viewer', () => {
    const { sent, next } = run('viewer', { admin_email: 'm@x.by' });
    expect(sent).toEqual({ admin_email: null });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('applied twice (router gate + route tier) wraps the answer once', () => {
    // The projection is idempotent, so a double wrap would not change the
    // output — the check is that the second application does not stack
    // another wrapper (one pass over the body per response): res.json after
    // the second application is the very function the first one installed.
    const res = { locals: {}, json: (value) => value };
    const next = jest.fn();
    viewerResponseProjection({ user: { role: 'viewer' } }, res, next);
    const wrapped = res.json;
    viewerResponseProjection({ user: { role: 'viewer' } }, res, next);
    expect(res.json).toBe(wrapped);
    expect(res.json({ admin_email: 'm@x.by' })).toEqual({ admin_email: null });
    expect(next).toHaveBeenCalledTimes(2);
  });

  test('leaves the answer of an admin untouched', () => {
    const { sent, next } = run('admin', { admin_email: 'm@x.by' });
    expect(sent).toEqual({ admin_email: 'm@x.by' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
