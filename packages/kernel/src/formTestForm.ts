import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';

/**
 * A three page, sixty three field form that has every kind of field the forms tools meet, built here so no binary is
 * committed (B10). It mirrors the owner's own `form-test.pdf` field for field: a registration page, an order page with
 * a read-only reference, and a page of edge cases (accents, a length limit, a comb box, a linked name, a rotated field,
 * an editable dropdown, a grid of tick boxes). Used only by tests.
 */

/** How many fields the form holds, so a case that counts them names the figure it counts against. */
export const FORM_TEST_FIELD_COUNT = 63;

/** The value the read-only reference carries, and so what an export of this form writes for it. */
export const FORM_TEST_ORDER_REF = 'ORD-1001';

/** Builds the form, with every field empty except the read-only reference. */
export async function buildFormTestPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const form = document.getForm();
  const line = { borderColor: rgb(0, 0, 0), borderWidth: 1 } as const;

  const label = (page: ReturnType<typeof document.addPage>, text: string, x: number, y: number): void => {
    page.drawText(text, { x, y, size: 10, font });
  };
  const text = (
    page: ReturnType<typeof document.addPage>,
    name: string,
    x: number,
    y: number,
    width: number,
    height = 21,
  ) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x, y, width, height, font, ...line });
    return field;
  };
  const tick = (page: ReturnType<typeof document.addPage>, name: string, x: number, y: number): void => {
    form.createCheckBox(name).addToPage(page, { x, y, width: 15, height: 15, ...line });
  };

  const first = document.addPage([595, 842]);
  first.drawText('Registration', { x: 50, y: 790, size: 18, font });
  label(first, 'Full name', 50, 706);
  text(first, 'full_name', 170, 700, 300);
  label(first, 'Email', 50, 676);
  text(first, 'email', 170, 670, 300);
  label(first, 'Phone', 50, 646);
  text(first, 'phone', 170, 640, 150);
  label(first, 'Date of birth', 50, 616);
  label(first, 'DD_MM_YYYY', 280, 616);
  text(first, 'date_of_birth', 170, 610, 100);
  label(first, 'Postcode', 50, 586);
  const postcode = text(first, 'postcode', 170, 580, 140);
  postcode.setMaxLength(7);
  postcode.enableCombing();
  label(first, 'Plan', 50, 513);
  const plan = form.createRadioGroup('plan');
  for (const [option, x] of [
    ['basic', 170],
    ['plus', 270],
    ['pro', 380],
  ] as const) {
    plan.addOptionToPage(option, first, { x, y: 510, width: 15, height: 15, ...line });
    label(first, option, x + 20, 513);
  }
  label(first, 'Region', 50, 481);
  const region = form.createDropdown('region');
  region.addOptions(['North', 'South', 'East', 'West']);
  region.addToPage(first, { x: 170, y: 475, width: 150, height: 21, font, ...line });
  label(first, 'Interests', 50, 440);
  const interests = form.createOptionList('interests');
  interests.addOptions(['Art', 'Music', 'Sport', 'Travel', 'Food']);
  interests.addToPage(first, { x: 170, y: 370, width: 150, height: 85, font, ...line });
  for (const [name, y, words] of [
    ['newsletter', 295, 'Send me the newsletter'],
    ['events', 270, 'Tell me about events'],
    ['terms', 245, 'I accept the terms'],
  ] as const) {
    tick(first, name, 50, y);
    label(first, words, 75, y + 3);
  }
  label(first, 'Comments', 50, 200);
  const comments = text(first, 'comments', 50, 85, 495, 105);
  comments.enableMultiline();

  const second = document.addPage([595, 842]);
  second.drawText('Order', { x: 50, y: 790, size: 18, font });
  label(second, 'Order reference', 50, 731);
  const reference = text(second, 'order_ref', 170, 725, 150);
  reference.setText(FORM_TEST_ORDER_REF);
  reference.enableReadOnly();
  label(second, 'Customer', 50, 701);
  text(second, 'customer', 170, 695, 300);
  for (let row = 1; row <= 6; row += 1) {
    const y = 612 - (row - 1) * 28;
    text(second, `item_${String(row)}`, 50, y, 230);
    text(second, `qty_${String(row)}`, 290, y, 50);
    text(second, `price_${String(row)}`, 350, y, 90);
    text(second, `total_${String(row)}`, 450, y, 95);
  }
  label(second, 'Grand total', 370, 436);
  text(second, 'grand_total', 450, 430, 95);
  label(second, 'Delivery', 50, 393);
  const delivery = form.createRadioGroup('delivery');
  for (const [option, x] of [
    ['post', 170],
    ['courier', 260],
    ['collect', 360],
  ] as const) {
    delivery.addOptionToPage(option, second, { x, y: 390, width: 15, height: 15, ...line });
    label(second, option, x + 20, 393);
  }
  label(second, 'Gift wrap', 50, 348);
  tick(second, 'gift_wrap', 170, 345);
  label(second, 'Delivery notes', 50, 315);
  text(second, 'delivery_notes', 170, 230, 375, 95).enableMultiline();
  label(second, 'PIN', 50, 201);
  text(second, 'pin', 170, 195, 100).enablePassword();
  label(second, 'Small font', 50, 164);
  text(second, 'small_font', 170, 160, 200, 15).setFontSize(6);
  label(second, 'Large font', 50, 125);
  text(second, 'large_font', 170, 115, 300, 33).setFontSize(20);

  const third = document.addPage([595, 842]);
  third.drawText('Edge cases', { x: 50, y: 790, size: 18, font });
  label(third, 'Accents', 50, 731);
  text(third, 'accents', 200, 725, 300);
  label(third, 'At most ten', 50, 696);
  text(third, 'max_ten', 200, 690, 150).setMaxLength(10);
  label(third, 'Narrow', 50, 661);
  text(third, 'narrow', 200, 655, 40);
  label(third, 'Overflow', 50, 626);
  text(third, 'overflow', 200, 620, 150);
  label(third, 'Linked', 50, 591);
  const linked = form.createTextField('linked_name');
  linked.addToPage(third, { x: 200, y: 585, width: 150, height: 21, font, ...line });
  linked.addToPage(third, { x: 380, y: 585, width: 150, height: 21, font, ...line });
  label(third, 'Rotated', 50, 520);
  form.createTextField('rotated').addToPage(third, {
    x: 231,
    y: 470,
    width: 100,
    height: 20,
    font,
    rotate: degrees(90),
    ...line,
  });
  label(third, 'Editable', 50, 436);
  const editable = form.createDropdown('editable_dropdown');
  editable.addOptions(['One', 'Two', 'Three']);
  editable.enableEditing();
  editable.addToPage(third, { x: 200, y: 430, width: 150, height: 21, font, ...line });
  label(third, 'Grid', 50, 388);
  for (let cell = 1; cell <= 10; cell += 1) tick(third, `grid_${String(cell)}`, 200 + (cell - 1) * 30, 385);
  label(third, 'Date signed', 50, 256);
  text(third, 'date_signed', 200, 250, 120);

  return document.save();
}
