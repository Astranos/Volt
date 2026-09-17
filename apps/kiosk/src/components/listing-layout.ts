import type { DetailBlock } from "../catalog";

const conditionHeading = /^(?:cosmetic(?:\s+condition)?|functionality(?:\s+condition)?|functional\s+condition)\s*:?$/i;

export function partitionListing(details: readonly DetailBlock[]): {
  conditionNotes: DetailBlock[];
  mainDetails: DetailBlock[];
} {
  const conditionNotes: DetailBlock[] = [];
  const mainDetails: DetailBlock[] = [];
  let inConditionSection = false;
  for (const block of details) {
    if (block.kind === "heading") {
      inConditionSection = conditionHeading.test(block.text.trim());
    }
    (inConditionSection ? conditionNotes : mainDetails).push(block);
  }
  return { conditionNotes, mainDetails };
}
