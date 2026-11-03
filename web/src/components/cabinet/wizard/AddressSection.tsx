'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CITIES } from '@/lib/partner/constants';

import { Field, SectionCard } from './primitives';
import type { SectionProps } from './types';

/**
 * What the partner reads when the assist refuses (app/api/geocode/route.ts):
 * a gone session is named, so it does not read as «no such address»; every
 * other refusal keeps the general sentence. Each ends with the way out.
 */
export function geocodeRefusalText(code: string | undefined): string {
  switch (code) {
    case 'NO_SESSION':
      return 'Сессия закончилась — войдите снова или введите координаты вручную.';
    case 'RATE_LIMITED':
      return 'Слишком много запросов за час — введите координаты вручную.';
    case 'TOO_LONG':
      return 'Адрес слишком длинный — сократите его или введите координаты вручную.';
    default:
      return 'Не удалось определить координаты. Введите вручную.';
  }
}

/*
 * Address: city + street + building, with a geocode assist (Decision 3) that
 * fills lat/lng via the /api/geocode proxy. lat/lng stay the editable canon — the
 * partner can override. Left empty, the create payload substitutes the city
 * center (Decision 5), so geocoding is optional.
 */
export function AddressSection({ form, patch, disabled }: SectionProps) {
  const [geocoding, setGeocoding] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const geocode = async () => {
    const q = [form.city, form.street, form.building]
      .filter(Boolean)
      .join(', ')
      .trim();
    if (q.length < 3) {
      setGeoMsg('Сначала заполните город и улицу.');
      return;
    }
    setGeocoding(true);
    setGeoMsg(null);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      const json = (await res.json()) as {
        result: { lat: number; lng: number } | null;
        code?: string;
      };
      if (json?.result) {
        patch({ latitude: json.result.lat, longitude: json.result.lng });
        setGeoMsg('Координаты определены — проверьте точку на карте.');
      } else if (res.ok) {
        setGeoMsg('Адрес не найден — введите координаты вручную.');
      } else {
        setGeoMsg(geocodeRefusalText(json?.code));
      }
    } catch {
      setGeoMsg('Не удалось определить координаты. Введите вручную.');
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <SectionCard
      id="section-address"
      title="Адрес"
      description="Координаты можно определить по адресу и при необходимости поправить."
    >
      <Field label="Город" htmlFor="f-city">
        <select
          id="f-city"
          value={form.city}
          disabled={disabled}
          onChange={(e) => patch({ city: e.target.value })}
          className="h-12 w-full rounded-[10px] border border-input bg-background px-4 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Выберите город</option>
          {CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid gap-l sm:grid-cols-2">
        <Field label="Улица" htmlFor="f-street">
          <Input
            id="f-street"
            value={form.street}
            disabled={disabled}
            onChange={(e) => patch({ street: e.target.value })}
            placeholder="проспект Независимости"
          />
        </Field>
        <Field label="Дом" htmlFor="f-building">
          <Input
            id="f-building"
            value={form.building}
            disabled={disabled}
            onChange={(e) => patch({ building: e.target.value })}
            placeholder="10"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Широта">
          <Input
            type="number"
            step="0.0001"
            value={form.latitude ?? ''}
            disabled={disabled}
            onChange={(e) =>
              patch({
                latitude: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="w-40"
          />
        </Field>
        <Field label="Долгота">
          <Input
            type="number"
            step="0.0001"
            value={form.longitude ?? ''}
            disabled={disabled}
            onChange={(e) =>
              patch({
                longitude:
                  e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="w-40"
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || geocoding}
          onClick={geocode}
        >
          {geocoding ? 'Поиск…' : 'Определить по адресу'}
        </Button>
      </div>
      {geoMsg && (
        <p className="text-caption-m text-figma-text-grey">{geoMsg}</p>
      )}
      {form.latitude == null && form.longitude == null && (
        <p className="text-caption-m text-figma-text-grey">
          Если не указать координаты, мы временно поставим центр города — вы
          сможете уточнить позже.
        </p>
      )}
    </SectionCard>
  );
}
