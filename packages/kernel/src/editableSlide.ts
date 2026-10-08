import { xmlText } from './ooxmlPackage.js';
import type { EditableSlide, PictureSource, ShapeCommand, SlideObject, SlideRun, SlideShape, SlideTextBox } from './slideModel.js';

/**
 * An editable slide as PresentationML
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * The spelling of `slideModel.ts`'s objects and nothing else: it decides no layout, no grouping and no
 * fallback. A text box is wrap-off with autofit off and zero insets, its lines kept as explicit breaks
 * in one paragraph and spaced by the page's own pitch, so nothing reflows when PowerPoint opens it
 * and a font it substitutes cannot move a line onto its neighbour.
 *
 * Text and attribute values go through `xmlText`, the one escape every Office part uses (B3a).
 */

const EMU_PER_POINT = 12_700;

/** A picture whose bytes are in hand. */
export type EmbeddedSource = Extract<PictureSource, { readonly kind: 'embedded' }>;

/** A slide whose every picture is resolved to bytes. */
export type ResolvedSlide = EditableSlide<EmbeddedSource>;

/** The package parts one slide brings. */
export interface SlideParts {
  readonly xml: string;
  /** Relationships beyond the layout's, as `[id, type, target]`. */
  readonly relationships: readonly (readonly [id: string, type: string, target: string])[];
  readonly media: readonly { readonly path: string; readonly bytes: Uint8Array }[];
}

/** A run's text with its line ends folded to a space: a break is `<a:br/>`, never a character in a run. */
function runText(text: string): string {
  return xmlText(text.replace(/[\r\n]+/gu, ' '));
}

/**
 * The furthest a coordinate is written from the slide's origin, in EMU: two of PowerPoint's largest slides (56 inches a
 * side, ADR-0072). A page's own numbers are the document's and a hostile one can state 1e30, which `Math.round` prints as
 * `1.27e+34`: not an integer, so a file PowerPoint repairs or refuses. Nothing further than a slide beyond the slide is
 * ever seen, so the clamp changes nothing a person could look at.
 */
const EMU_LIMIT = 2 * 4032 * EMU_PER_POINT;

function emu(points: number): string {
  return String(Math.max(-EMU_LIMIT, Math.min(EMU_LIMIT, Math.round(points * EMU_PER_POINT))));
}

function nonNegative(points: number): string {
  return String(Math.max(0, Math.min(EMU_LIMIT, Math.round(points * EMU_PER_POINT))));
}

function turn(degrees: number): string {
  return String(Math.round((((degrees % 360) + 360) % 360) * 60_000));
}

function transform(object: { x: number; y: number; width: number; height: number }, rotation: number, flipV = false): string {
  const rot = rotation === 0 ? '' : ` rot="${turn(rotation)}"`;
  const flip = flipV ? ' flipV="1"' : '';
  return (
    `<a:xfrm${rot}${flip}><a:off x="${emu(object.x)}" y="${emu(object.y)}"/>` +
    `<a:ext cx="${nonNegative(object.width)}" cy="${nonNegative(object.height)}"/></a:xfrm>`
  );
}

function solid(colour: string, alpha: number): string {
  const transparency = alpha < 1 ? `<a:alpha val="${String(Math.round(Math.max(0, alpha) * 100_000))}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${colour}">${transparency}</a:srgbClr></a:solidFill>`;
}

function runProperties(run: SlideRun): string {
  const size = Math.max(100, Math.min(400_000, Math.round(run.size * 100)));
  const bold = run.bold ? ' b="1"' : '';
  const italic = run.italic ? ' i="1"' : '';
  // THE FALLBACK FAMILY a machine without the font substitutes by: fixed pitch, serif or plain.
  const family = run.mono ? '49' : run.serif ? '18' : '34';
  const face = xmlText(run.font);
  return (
    `<a:rPr lang="en-US" sz="${String(size)}"${bold}${italic} dirty="0">${solid(run.colour, 1)}` +
    `<a:latin typeface="${face}" pitchFamily="${family}"/><a:cs typeface="${face}" pitchFamily="${family}"/></a:rPr>`
  );
}

function textBody(box: SlideTextBox): string {
  const spacing = Math.max(100, Math.round(box.pitch * 100));
  const margin = box.marginLeft > 0 ? ` marL="${nonNegative(box.marginLeft)}"` : '';
  const indent = box.indent === 0 ? '' : ` indent="${emu(box.indent)}"`;
  const lead = box.lines[0]?.[0];
  let paragraph = '';
  box.lines.forEach((line, at) => {
    if (at > 0) paragraph += `<a:br>${lead === undefined ? '' : runProperties(lead)}</a:br>`;
    for (const run of line) paragraph += `<a:r>${runProperties(run)}<a:t>${runText(run.text)}</a:t></a:r>`;
  });
  return (
    '<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>' +
    `<a:p><a:pPr${margin}${indent} algn="${box.align}" rtl="${box.rtl ? '1' : '0'}"><a:lnSpc><a:spcPts val="${String(spacing)}"/></a:lnSpc>` +
    `<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${paragraph}</a:p></p:txBody>`
  );
}

function pathGeometry(commands: readonly ShapeCommand[], width: number, height: number, filled: boolean): string {
  const w = Math.max(1, Math.round(width * EMU_PER_POINT));
  const h = Math.max(1, Math.round(height * EMU_PER_POINT));
  const pt = (x: number, y: number): string => `<a:pt x="${emu(x)}" y="${emu(y)}"/>`;
  let body = '';
  for (const command of commands) {
    switch (command.kind) {
      case 'move':
        body += `<a:moveTo>${pt(command.x, command.y)}</a:moveTo>`;
        break;
      case 'line':
        body += `<a:lnTo>${pt(command.x, command.y)}</a:lnTo>`;
        break;
      case 'curve':
        body += `<a:cubicBezTo>${pt(command.x1, command.y1)}${pt(command.x2, command.y2)}${pt(command.x, command.y)}</a:cubicBezTo>`;
        break;
      case 'close':
        body += '<a:close/>';
        break;
    }
  }
  return (
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/>' +
    `<a:pathLst><a:path w="${String(w)}" h="${String(h)}"${filled ? '' : ' fill="none"'}>${body}</a:path></a:pathLst></a:custGeom>`
  );
}

function shapeBody(shape: SlideShape): string {
  const geometry =
    shape.geometry.kind === 'rect'
      ? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
      : shape.geometry.kind === 'line'
        ? '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>'
        : pathGeometry(shape.geometry.commands, shape.width, shape.height, shape.fill !== null);
  const fill = shape.fill === null ? '<a:noFill/>' : solid(shape.fill.colour, shape.fill.alpha);
  const line = shape.line;
  const cap = line?.cap === 'round' ? 'rnd' : line?.cap === 'square' ? 'sq' : 'flat';
  const join = line?.join === 'round' ? '<a:round/>' : line?.join === 'bevel' ? '<a:bevel/>' : '<a:miter lim="800000"/>';
  const outline =
    line === null
      ? '<a:ln><a:noFill/></a:ln>'
      : `<a:ln w="${nonNegative(line.width)}" cap="${cap}">${solid(line.colour, line.alpha)}${join}</a:ln>`;
  return `${geometry}${fill}${outline}`;
}

/** One slide, and the media it brings. `slideNumber` is one-based and names the media. */
export function editableSlideParts(slide: ResolvedSlide, slideNumber: number, xmlNamespaces: string): SlideParts {
  const relationships: [string, string, string][] = [];
  const media: { path: string; bytes: Uint8Array }[] = [];
  let id = 1;
  let body = '';
  const draw = (object: SlideObject<EmbeddedSource>): void => {
    id += 1;
    switch (object.kind) {
      case 'text':
        body +=
          `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Text ${String(id)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
          `<p:spPr>${transform(object, object.rotation)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBody(object)}</p:sp>`;
        return;
      case 'picture': {
        const file = `slide${String(slideNumber)}_${String(media.length + 1)}.${object.source.extension}`;
        media.push({ path: `ppt/media/${file}`, bytes: object.source.bytes });
        const relationship = `rId${String(relationships.length + 2)}`;
        relationships.push([relationship, 'image', `../media/${file}`]);
        body +=
          `<p:pic><p:nvPicPr><p:cNvPr id="${String(id)}" name="Picture ${String(id)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
          `<p:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
          `<p:spPr>${transform(object, object.rotation, object.flipV)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
        return;
      }
      case 'shape':
        body +=
          `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Shape ${String(id)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
          `<p:spPr>${transform(object, 0, object.geometry.kind === 'line' && object.geometry.flipV)}${shapeBody(object)}</p:spPr></p:sp>`;
        return;
    }
  };
  for (const object of slide.objects) draw(object);
  const xml =
    `<p:sld ${xmlNamespaces}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return { xml, relationships, media };
}
