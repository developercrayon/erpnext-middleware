export function evaluateTemplate(template: string, data: any, arrayIndex?: number): any {
  // If template is null/undefined or not a string, return it as is or handle accordingly
  if (typeof template !== 'string') {
    return template;
  }

  // Extract the inner path if it's wrapped in {{ }}, e.g. {{buyer.buyerName}}
  const match = template.match(/^{{(.+?)}}$/);
  if (!match) {
    // If it's not a template (e.g. static text), just return it
    return template;
  }

  let path = match[1].trim();

  // If we are evaluating for an array item, substitute [*] with the provided index
  if (arrayIndex !== undefined) {
    path = path.replace(/\[\*\]/g, `[${arrayIndex}]`);
  } else {
    // Fallback: if no arrayIndex is passed but [*] exists, default to [0]
    path = path.replace(/\[\*\]/g, '[0]');
  }

  // Split path by dots or brackets. E.g., buyer.buyerName or orderItems[0].product.sellerSku
  // Normalize brackets to dots: orderItems[0] -> orderItems.0
  const normalizedPath = path.replace(/\[(\w+)\]/g, '.$1');
  const properties = normalizedPath.split('.');

  let current = data;
  for (const prop of properties) {
    if (current === undefined || current === null) {
      return undefined;
    }
    current = current[prop];
  }

  return current;
}
