# Public search advertising setup

Advertising is disabled by default. No AdSense publisher account, ad unit, consent provider, or live advertisement has been created by this change.

The only placement is below a successful public UPC search with at least one catalog match. Loading, empty, and failed searches have no placement. Account, billing, dashboard, and scan-entry pages have no placements. A signed-in account must resolve to the free workspace tier before an ad can load. Paid and unresolved account policies suppress ads.

## Before enabling

1. Create the AdSense account and complete site review for the production domain. Confirm commercial display rights for catalog fields and update the public privacy disclosures.
2. Create a responsive display ad unit. Keep AdSense Auto ads disabled for this site so Google cannot add placements to other pages.
3. Install a [Google-certified web CMP](https://support.google.com/adsense/answer/13554116?hl=en) separately, using its official deployment instructions. Load its `window.__tcfapi` stub before the Volt application. Configure the CMP for TCF v2.3 and Google Advertising Products, vendor 755. Google requires TCF v2.3 for new strings generated from March 1, 2026. See [Google's current TCF guidance](https://support.google.com/adsense/answer/9999955?hl=en).
4. Confirm the provider's numeric TCF CMP ID against Google's current certification list. Set the same ID in the configuration below. This configuration records the verified provider selection; the application cannot certify a CMP itself.
5. Publish the exact account-specific `ads.txt` entry supplied by AdSense at the production domain's `/ads.txt`. Use Google's [ads.txt guide](https://support.google.com/adsense/answer/12171612?hl=en). No placeholder publisher file is generated because no publisher account exists yet.

Set these public build variables in the web deployment and rebuild through the normal release process:

```dotenv
VITE_ADSENSE_ENABLED=true
VITE_ADSENSE_PUBLISHER_ID=ca-pub-YOUR_16_DIGIT_PUBLISHER_ID
VITE_ADSENSE_PUBLIC_SEARCH_SLOT=YOUR_10_DIGIT_AD_UNIT_ID
VITE_ADSENSE_CERTIFIED_CMP_ID=YOUR_VERIFIED_NUMERIC_CMP_ID
```

Identifiers must match these formats exactly. Missing or invalid values leave ads disabled. Use actual identifiers from the approved account and certified provider.

## Consent behavior and checks

Volt subscribes to the [standard TCF `addEventListener` API](https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md) and removes the listener when the placement unmounts. The configured CMP must report loaded, ready consent with a service-specific TC string, disclose Google vendor 755, and report explicit consent for Google and purposes 1, 2, 7, 9, and 10. Publisher restrictions that prohibit processing or require a different legal basis block the placement. This conservative gate requires explicit consent globally; legitimate interest alone does not enable an ad. Configure the CMP accordingly if you intend to serve ads outside the EEA, UK, and Switzerland.

Missing, denied, withdrawn, or failed CMP callbacks suppress the placement. Volt has no fallback consent banner. The ad tag disables personalization and loads only after account eligibility and consent pass. Google's own tag remains responsible for interpreting the full TC string. Consent withdrawal removes the placement and prevents further slot requests, including a pending script-load callback. It cannot undo an ad request already sent before withdrawal.

Before enabling production, verify the network panel shows no Google ad tag or ad requests on empty searches, denied consent, unavailable CMPs, paid accounts, or account pages. On an eligible consented search, verify the responsive slot, Google vendor disclosure, non-personalized request, and AdSense consent diagnostics. Test withdrawal and navigation away while the tag is loading. Confirm the published `/ads.txt` is accepted by AdSense.
