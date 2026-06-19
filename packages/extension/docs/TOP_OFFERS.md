# Offer Calculator Guide

The live calculator is implemented in:

- [../src/domain/top-offers.ts](../src/domain/top-offers.ts)
- [../src/components/sidepanel/TopOffers.tsx](../src/components/sidepanel/TopOffers.tsx)

Input `A2` is the projected selling price. Results are floored to the nearest `$5`.

## Standard Offer

Starting:

```text
=IF(A2 < 50, FLOOR(A2 * 0.1, 5), IF(A2 < 100, FLOOR(A2 * 0.2, 5), IF(A2 < 200, FLOOR(A2 * 0.25, 5), IF(A2 < 500, FLOOR(A2 * 0.3, 5), IF(A2 < 750, FLOOR(A2 * 0.4, 5), FLOOR(A2 * 0.5, 5))))))
```

Max:

```text
=IF(A2 < 50, FLOOR(A2 * 0.2, 5), IF(A2 < 100, FLOOR(A2 * 0.25, 5), IF(A2 < 200, FLOOR(A2 * 0.3, 5), IF(A2 < 500, FLOOR(A2 * 0.4, 5), IF(A2 < 750, FLOOR(A2 * 0.5, 5), FLOOR(A2 * 0.6, 5))))))
```

## Premium Offer

Starting:

```text
=IF(A2 < 50, FLOOR(A2 * 0.1, 5), IF(A2 < 100, FLOOR(A2 * 0.2, 5), IF(A2 < 200, FLOOR(A2 * 0.25, 5), IF(A2 < 500, FLOOR(A2 * 0.45, 5), IF(A2 < 750, FLOOR(A2 * 0.55, 5), FLOOR(A2 * 0.65, 5))))))
```

Max:

```text
=IF(A2 < 50, FLOOR(A2 * 0.2, 5), IF(A2 < 100, FLOOR(A2 * 0.25, 5), IF(A2 < 200, FLOOR(A2 * 0.3, 5), IF(A2 < 500, FLOOR(A2 * 0.5, 5), IF(A2 < 750, FLOOR(A2 * 0.6, 5), FLOOR(A2 * 0.7, 5))))))
```

## Checkout Offer

Starting uses the standard max offer.

Max:

```text
=FLOOR(A2 * 0.65, 5)
```

## New Customer Offer

Starting uses the standard max offer.

Max:

```text
=IF(A2 < 50, FLOOR(A2 * 0.3, 5), IF(A2 < 100, FLOOR(A2 * 0.35, 5), IF(A2 < 250, FLOOR(A2 * 0.45, 5), IF(A2 < 500, FLOOR(A2 * 0.55, 5), IF(A2 < 750, FLOOR(A2 * 0.6, 5), FLOOR(A2 * 0.7, 5))))))
```

## Custom Offers

Settings can define custom rate tables under `cmdkSettings.topOffers.customOffers`. Each custom offer uses ordered threshold rules plus a default percentage for values above the last threshold.
