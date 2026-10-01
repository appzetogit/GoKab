/**
 * Shared "is this document actually complete" rules for admin-managed
 * `DriverNeededDocument` templates. Used by the driver controller (adding or
 * editing a fleet vehicle / fleet driver) and the admin service (approving a
 * fleet vehicle) so the two can never drift into enforcing different things
 * for the same template.
 */

// Which required field keys across `templates` are missing from `documents`.
export const findMissingDocuments = (templates, documents = {}) =>
  templates
    .flatMap((template) =>
      (Array.isArray(template.fields) ? template.fields : [])
        .filter((field) => field.required ?? template.is_required ?? false)
        .map((field) => String(field.key || '').trim())
        .filter(Boolean),
    )
    .filter((key) => !documents?.[key]);

// A document key can be present (findMissingDocuments passes) while its
// number/expiry are still missing — e.g. an RC photo uploaded with no plate
// number or expiry date typed in.
export const findMissingDocumentDetails = (templates, documents = {}) => {
  const missing = [];

  for (const template of templates) {
    // Only an admin-marked-required template gets this enforcement — e.g.
    // Commercial Permit tracks an expiry date but is only mandatory via its
    // own explicit commercial-vehicle check elsewhere, not via is_required.
    if (!template.is_required) continue;
    if (!template.has_identify_number && !template.has_expiry_date) continue;

    const templateDocuments = (Array.isArray(template.fields) ? template.fields : [])
      .map((field) => documents?.[field.key])
      .filter(Boolean);

    if (templateDocuments.length === 0) continue;

    const templateName = String(template.name || 'Document').trim();
    const hasIdentifyNumber = templateDocuments.some((item) =>
      String(item?.identifyNumber || item?.identify_number || '').trim(),
    );
    const hasExpiryDate = templateDocuments.some((item) =>
      String(item?.expiryDate || item?.expiry_date || '').trim(),
    );

    if (template.has_identify_number && !hasIdentifyNumber) {
      missing.push(`${templateName} ID number`);
    }
    if (template.has_expiry_date && !hasExpiryDate) {
      missing.push(`${templateName} expiry date`);
    }
  }

  return missing;
};
