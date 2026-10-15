/**
 * Belarus phone number on an establishment card — the one rule shared by the
 * partner validator (create + update) and the seed bulk-import contract.
 *
 * +375, then a mobile operator code (25 life:), 29 A1/MTS, 33 MTS, 44 A1) or a
 * city/region area code (15x Grodno, 16x Brest, 17x Minsk, 21x Vitebsk,
 * 22x Mogilev, 23x Gomel), 9 digits in all after 375. Restaurants commonly
 * publish a city landline, and it is what guests call (decision of the
 * Coordinator, 13.10.2026; until then only the four mobile codes passed, and
 * a partner with a landline was refused at the last wizard step).
 *
 * Why a list of codes and not «+375 and any 9 digits»: the mobile wizard
 * prepends 375 to input that does not start with 3, so a number typed the
 * domestic way — «8 029 123 45 67», «8 017 …» — becomes +375 80…, a number
 * that does not exist. Code 80 is not on the list, so it is still refused.
 *
 * Mirrored by web/src/lib/partner/constants.ts BELARUS_PHONE_RE and by the
 * mobile wizard's basic-info step check (manual cross-target sync).
 */
export const BELARUS_PHONE_REGEX = /^\+375(25|29|33|44|1[5-7]|2[1-3])\d{7}$/;
