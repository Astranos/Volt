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

Starting uses the standard max offer unless Checkout Start rates are customized
in settings.

Max:

```text
=FLOOR(A2 * 0.65, 5)
```

## New Customer Offer

Starting uses the standard max offer unless New Customer Start rates are
customized in settings.

Max:

```text
=IF(A2 < 50, FLOOR(A2 * 0.3, 5), IF(A2 < 100, FLOOR(A2 * 0.35, 5), IF(A2 < 250, FLOOR(A2 * 0.45, 5), IF(A2 < 500, FLOOR(A2 * 0.55, 5), IF(A2 < 750, FLOOR(A2 * 0.6, 5), FLOOR(A2 * 0.7, 5))))))
```

The start and max New Customer rate tables can be customized in settings.

## Start Rate Customization

Settings can enable custom Start rates for each built-in offer. If a Start
override is disabled, the calculator keeps the default behavior:

- Standard uses the default standard starting guide.
- Premium uses the default premium starting guide.
- Checkout uses the current standard max guide.
- New Customer uses the current standard max guide.

## Visibility

Settings can hide or show each built-in calculator card:

- Standard Offer
- Premium Offer
- Checkout Offer
- New Customer Offer

## Custom Offers

Settings can define custom rate tables under
`cmdkSettings.topOffers.customOffers`. Each custom offer now renders a Start and
Max amount. The Max amount uses the custom offer's main ordered threshold rules
plus default percentage. The Start amount matches the Standard Offer Start
unless the custom offer has its own starting rules enabled.
Custom offers can also be hidden without deleting their rate table.
