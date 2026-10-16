import { expr24, expr24Bottom, expr25, expr25Bottom } from './content'

export type Region = { id: string; x: number; y: number; w: number; h: number }

export type PageShot = {
  src: string
  w: number
  h: number
  alt: string
  regions: Region[]
  slim?: boolean
}

function shot(
  src: string,
  w: number,
  h: number,
  alt: string,
  regions: Region[],
  slim?: boolean,
): PageShot {
  return { src, w, h, alt, regions, slim }
}

function box(id: string, x: number, y: number, w: number, h: number): Region {
  return { id, x, y, w, h }
}

export const shots = {
  rule: shot('/figures/rule.jpg', 890, 130, 'Правило вверху страницы 24', [
    box('banner', 36, 18, 820, 78),
  ]),
  expr24: shot('/figures/expr24.jpg', 890, 195, 'Задание 1, страница 24', [
    box(expr24[0], 140, 34, 205, 40),
    box(expr24[1], 150, 70, 195, 44),
    box(expr24[2], 138, 114, 265, 44),
    box(expr24[3], 155, 152, 215, 40),
    box(expr24[4], 410, 34, 170, 40),
    box(expr24[5], 412, 70, 170, 44),
    box(expr24[6], 470, 114, 255, 44),
    box(expr24[7], 470, 152, 255, 40),
    box(expr24[8], 638, 34, 215, 40),
    box(expr24[9], 640, 70, 220, 44),
  ]),
  multiply: shot('/figures/multiply.jpg', 870, 215, 'Задание 2, таблица на странице 24', [
    box('0', 396, 34, 50, 158),
    box('1', 452, 34, 50, 158),
    box('2', 508, 34, 49, 158),
    box('3', 563, 34, 49, 158),
    box('4', 618, 34, 51, 158),
    box('5', 675, 34, 49, 158),
  ]),
  cubes: shot('/figures/cubes.jpg', 890, 135, 'Задание 3, страница 24', [
    box('rows', 630, 22, 250, 34),
    box('eight', 268, 56, 230, 38),
    box('red', 640, 56, 200, 38),
    box('ask', 240, 90, 560, 38),
  ]),
  chairs: shot('/figures/chairs.jpg', 890, 145, 'Задание 4, страница 24', [
    box('rows', 185, 26, 370, 34),
    box('total', 575, 26, 160, 34),
    box('q1a', 745, 26, 130, 32),
    box('q1b', 130, 60, 380, 36),
    box('q2a', 790, 68, 85, 30),
    box('q2b', 130, 96, 200, 34),
    box('q3', 335, 96, 250, 34),
  ]),
  trees: shot('/figures/trees.jpg', 890, 137, 'Задание 5, страница 24', [
    box('birch', 250, 8, 220, 34),
    box('rowan', 505, 8, 200, 34),
    box('q1a', 715, 10, 160, 30),
    box('q1b', 135, 46, 540, 36),
    box('q2a', 680, 46, 190, 32),
    box('q2b', 135, 80, 410, 38),
  ]),
  geometry: shot('/figures/geometry.jpg', 890, 308, 'Задание 6, фигуры на странице 24', [
    box('square', 100, 90, 210, 210),
    box('tri', 320, 80, 320, 220),
    box('rect', 630, 120, 230, 180),
  ]),
  apples: shot('/figures/apples.jpg', 890, 190, 'Задание 7, страница 24', [
    box('was', 355, 16, 260, 32),
    box('took', 220, 50, 280, 38),
    box('adda', 720, 48, 155, 38),
    box('addb', 130, 86, 160, 34),
    box('equal', 505, 94, 230, 30),
    box('aska', 740, 88, 135, 32),
    box('askb', 130, 120, 570, 36),
  ]),
  rebus: shot(
    '/figures/rebus.jpg',
    260,
    550,
    'Ребусы на полях страницы 24',
    [box('house', 48, 108, 168, 420), box('top', 62, 150, 145, 170), box('bot', 62, 335, 145, 180)],
    true,
  ),
  expr24bottom: shot('/figures/expr24bottom.jpg', 890, 120, 'Примеры под чертой, страница 24', [
    box(expr24Bottom[0], 120, 36, 245, 46),
    box(expr24Bottom[1], 515, 36, 215, 46),
  ]),
  expr25: shot('/figures/expr25.jpg', 970, 165, 'Задание 1, страница 25', [
    box(expr25[0], 100, 96, 230, 44),
    box(expr25[1], 385, 96, 160, 44),
    box(expr25[2], 598, 96, 210, 44),
  ]),
  schemes: shot('/figures/schemes.jpg', 900, 265, 'Задание 2, схемы на странице 25', [
    box('s1', 110, 108, 190, 46),
    box('s4', 320, 108, 190, 46),
    box('s7', 580, 100, 270, 54),
    box('s2', 110, 152, 190, 46),
    box('s5', 320, 152, 210, 46),
    box('s8', 580, 148, 280, 52),
    box('s3', 110, 196, 190, 44),
    box('s6', 320, 196, 210, 44),
    box('s9', 580, 190, 280, 50),
  ]),
  fabric: shot('/figures/fabric.jpg', 970, 365, 'Задание 3, таблица на странице 25', [
    box('a0', 62, 168, 270, 46),
    box('b0', 344, 168, 205, 46),
    box('c0', 560, 168, 255, 46),
    box('a1', 62, 220, 270, 48),
    box('b1', 344, 220, 205, 48),
    box('c1', 560, 220, 255, 48),
    box('a2', 62, 276, 270, 48),
    box('b2', 344, 276, 205, 48),
    box('c2', 560, 276, 255, 48),
  ]),
  cloaks: shot('/figures/cloaks.jpg', 860, 205, 'Задание 4, страница 25', [
    box('n4', 475, 40, 155, 34),
    box('n3', 220, 76, 130, 32),
    box('n38', 600, 76, 230, 32),
    box('ask1', 296, 110, 540, 34),
    box('ask2', 95, 146, 200, 32),
  ]),
  shapes: shot('/figures/shapes.jpg', 970, 480, 'Задание 5, фигуры на странице 25', [
    box('p1', 118, 118, 214, 110),
    box('p2', 476, 114, 168, 100),
    box('p3', 124, 324, 176, 92),
    box('p4', 292, 176, 140, 136),
    box('p5', 448, 246, 132, 204),
    box('p6', 608, 236, 176, 170),
    box('p7', 750, 118, 66, 114),
  ]),
  kite: shot(
    '/figures/kite.jpg',
    325,
    760,
    'Какое число следующее, поля страницы 25',
    [
      box('1', 58, 300, 58, 58),
      box('6', 88, 360, 58, 58),
      box('12', 136, 396, 58, 58),
      box('19', 118, 468, 58, 58),
      box('27', 72, 512, 58, 58),
      box('36', 98, 556, 58, 58),
      box('q1', 136, 592, 58, 58),
      box('q2', 112, 652, 58, 58),
    ],
    true,
  ),
  expr25bottom: shot('/figures/expr25bottom.jpg', 970, 125, 'Примеры под чертой, страница 25', [
    box(expr25Bottom[0], 96, 40, 200, 42),
    box(expr25Bottom[1], 376, 40, 185, 42),
    box(expr25Bottom[2], 636, 40, 150, 42),
  ]),
}
