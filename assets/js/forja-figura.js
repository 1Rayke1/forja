(function (window) {
  "use strict";

  var doc = window.document;
  var NS = "http://www.w3.org/2000/svg";

  /* A prancha de referência cobre 240 × 520 unidades (renderizada a 480 × 1040 px),
     da cabeça aos pés, nas duas vistas. */
  var VIEWBOX = Object.freeze({ width: 240, height: 520 });

  var VIEWS = Object.freeze({
    front: "Vista anterior",
    back: "Vista posterior"
  });

  var ROLE_NAMES = Object.freeze({
    primary: "principal",
    secondary: "secundária",
    stabilizer: "estabilizadora",
    informed: "informada por você",
    focus: "região em foco"
  });

  var clipCounter = 0;

  function detectAssetPrefix() {
    if (!doc) return "../";
    var scripts = doc.getElementsByTagName ? doc.getElementsByTagName("script") : [];
    for (var i = 0; i < scripts.length; i += 1) {
      var src = (scripts[i].getAttribute && scripts[i].getAttribute("src")) || "";
      var idx = src.indexOf("assets/js/forja-figura.js");
      if (idx !== -1) return src.slice(0, idx);
    }
    return "../";
  }

  var ASSET_PREFIX = detectAssetPrefix();

  var PLATES = Object.freeze({
    front: ASSET_PREFIX + "assets/anatomia/anterior.png",
    back: ASSET_PREFIX + "assets/anatomia/posterior.png"
  });

  /*
   * Contornos de silhueta extraídos (Marching Squares) das pranchas de referência
   * (240 × 520). Cada silhueta é um caminho composto: cabeça + tronco, braços e
   * pernas, de modo que cubra a prancha de ponta a ponta, da cabeça aos pés, em
   * ambas as vistas. Regiões declaradas sem contornos para uma vista simplesmente
   * não são pintadas nessa vista (sem outsideFrame).
   */
    var SILHOUETTES = Object.freeze({
    front: "M 120 16 C 113.5 16 108.625 20.5 105.09375 27.3125 C 101.5625 34.125 99.375 43.25 98.25 52.5 C 97.125 61.75 97.0625 71.125 97.78125 78.4375 C 98.5 85.75 100 91 102 92 L 100 104 L 64 132 L 84 188 C 80.5 198.5 77.25 208.125 74.125 217.34375 C 71 226.5625 68 235.375 65 244.25 C 62 253.125 59 262.0625 55.875 271.53125 C 52.75 281 49.5 291 46 302 C 44.5 307 43 311.5 41.59375 315.4375 C 40.1875 319.375 38.875 322.75 37.75 325.5 C 36.625 328.25 35.6875 330.375 35.03125 331.8125 C 34.375 333.25 34 334 34 334 C 55 333 71 332.25 84.5 331.75 C 98 331.25 109 331 120 331 C 131 331 142 331.25 155.5 331.75 C 169 332.25 185 333 206 334 C 207 331 208 327.5 208.75 323.9375 C 209.5 320.375 210 316.75 210 313.5 C 210 310.25 209.5 307.375 208.25 305.3125 C 207 303.25 205 302 202 302 C 200.5 291 198.625 281 196.75 271.53125 C 194.875 262.0625 193 253.125 191.5 244.25 C 190 235.375 188.875 226.5625 188.5 217.34375 C 188.125 208.125 188.5 198.5 190 188 L 188 132 C 190 127.5 189.75 123.5 187.75 120.03125 C 185.75 116.5625 182 113.625 177 111.25 C 172 108.875 165.75 107.0625 158.75 105.84375 C 151.75 104.625 144 104 136 104 C 138 100 139.5 92.5 140.25 83.5 C 141 74.5 141 64 140 54 C 139 44 137 34.5 133.75 27.5 C 130.5 20.5 126 16 120 16 Z  M 64 132 C 58 136.5 53 143 48.96875 150.84375 C 44.9375 158.6875 41.875 167.875 39.75 177.75 C 37.625 187.625 36.4375 198.1875 36.15625 208.78125 C 35.875 219.375 36.5 230 38 240 C 37 245.5 36.625 251.375 36.75 257.28125 C 36.875 263.1875 37.5 269.125 38.5 274.75 C 39.5 280.375 40.875 285.6875 42.5 290.34375 C 44.125 295 46 299 48 302 L 40 314 L 52 308 C 54 304.5 55.875 300.125 57.53125 295.125 C 59.1875 290.125 60.625 284.5 61.75 278.5 C 62.875 272.5 63.6875 266.125 64.09375 259.625 C 64.5 253.125 64.5 246.5 64 240 C 66 234 67.75 227.875 69.3125 222.03125 C 70.875 216.1875 72.25 210.625 73.5 205.75 C 74.75 200.875 75.875 196.6875 76.9375 193.59375 C 78 190.5 79 188.5 80 188 Z  M 188 132 C 189.5 136.5 191.25 143 192.96875 150.84375 C 194.6875 158.6875 196.375 167.875 197.75 177.75 C 199.125 187.625 200.1875 198.1875 200.65625 208.78125 C 201.125 219.375 201 230 200 240 C 201 245.5 202.125 251.375 203.125 257.28125 C 204.125 263.1875 205 269.125 205.5 274.75 C 206 280.375 206.125 285.6875 205.625 290.34375 C 205.125 295 204 299 202 302 L 206 314 L 198 308 C 196.5 304.5 195 300.125 193.625 295.125 C 192.25 290.125 191 284.5 190 278.5 C 189 272.5 188.25 266.125 187.875 259.625 C 187.5 253.125 187.5 246.5 188 240 C 189.5 234 190.375 227.875 190.53125 222.03125 C 190.6875 216.1875 190.125 210.625 188.75 205.75 C 187.375 200.875 185.1875 196.6875 182.09375 193.59375 C 179 190.5 175 188.5 170 188 Z  M 34 334 C 33 337 32.125 341.375 31.40625 346.75 C 30.6875 352.125 30.125 358.5 29.75 365.5 C 29.375 372.5 29.1875 380.125 29.21875 388 C 29.25 395.875 29.5 404 30 412 C 29 419 28.125 426.125 27.40625 433.21875 C 26.6875 440.3125 26.125 447.375 25.75 454.25 C 25.375 461.125 25.1875 467.8125 25.21875 474.15625 C 25.25 480.5 25.5 486.5 26 492 C 25.5 496.5 24.5 500.375 23.375 503.65625 C 22.25 506.9375 21 509.625 20 511.75 C 19 513.875 18.25 515.4375 18.125 516.46875 C 18 517.5 18.5 518 20 518 L 44 518 L 48 512 L 46 504 C 47 500 48.125 495.375 49.34375 490.5 C 50.5625 485.625 51.875 480.5 53.25 475.5 C 54.625 470.5 56.0625 465.625 57.53125 461.25 C 59 456.875 60.5 453 62 450 C 63.5 446 65.125 441.875 66.96875 437.71875 C 68.8125 433.5625 70.875 429.375 73.25 425.25 C 75.625 421.125 78.3125 417.0625 81.40625 413.15625 C 84.5 409.25 88 405.5 92 402 C 94 398 96 393.625 97.84375 389.15625 C 99.6875 384.6875 101.375 380.125 102.75 375.75 C 104.125 371.375 105.1875 367.1875 105.78125 363.46875 C 106.375 359.75 106.5 356.5 106 354 C 106 351 105.75 347.875 105.28125 344.71875 C 104.8125 341.5625 104.125 338.375 103.25 335.25 C 102.375 332.125 101.3125 329.0625 100.09375 326.15625 C 98.875 323.25 97.5 320.5 96 318 Z  M 206 334 C 207 337 207.875 341.375 208.59375 346.75 C 209.3125 352.125 209.875 358.5 210.25 365.5 C 210.625 372.5 210.8125 380.125 210.78125 388 C 210.75 395.875 210.5 404 210 412 C 211 419 211.875 426.125 212.59375 433.21875 C 213.3125 440.3125 213.875 447.375 214.25 454.25 C 214.625 461.125 214.8125 467.8125 214.78125 474.15625 C 214.75 480.5 214.5 486.5 214 492 C 214.5 496.5 215.5 500.375 216.625 503.65625 C 217.75 506.9375 219 509.625 220 511.75 C 221 513.875 221.75 515.4375 221.875 516.46875 C 222 517.5 221.5 518 220 518 L 196 518 L 192 512 L 194 504 C 193 500 191.875 495.375 190.65625 490.5 C 189.4375 485.625 188.125 480.5 186.75 475.5 C 185.375 470.5 183.9375 465.625 182.46875 461.25 C 181 456.875 179.5 453 178 450 C 176.5 446 174.875 441.875 173.125 437.71875 C 171.375 433.5625 169.5 429.375 167.5 425.25 C 165.5 421.125 163.375 417.0625 161.125 413.15625 C 158.875 409.25 156.5 405.5 154 402 C 152 398 150 393.625 148.15625 389.15625 C 146.3125 384.6875 144.625 380.125 143.25 375.75 C 141.875 371.375 140.8125 367.1875 140.21875 363.46875 C 139.625 359.75 139.5 356.5 140 354 C 140 351 140.25 347.875 140.71875 344.71875 C 141.1875 341.5625 141.875 338.375 142.75 335.25 C 143.625 332.125 144.6875 329.0625 145.90625 326.15625 C 147.125 323.25 148.5 320.5 150 318 Z",
    back: "M 120 16 C 113.5 16 108.625 20.5 105.09375 27.3125 C 101.5625 34.125 99.375 43.25 98.25 52.5 C 97.125 61.75 97.0625 71.125 97.78125 78.4375 C 98.5 85.75 100 91 102 92 L 100 104 L 60 132 L 84 188 C 81 198.5 78.375 208.125 76.1875 216.90625 C 74 225.6875 72.25 233.625 71 240.75 C 69.75 247.875 69 254.1875 68.8125 259.71875 C 68.625 265.25 69 270 70 274 C 71.5 277 73 280.375 74.53125 283.90625 C 76.0625 287.4375 77.625 291.125 79.25 294.75 C 80.875 298.375 82.5625 301.9375 84.34375 305.21875 C 86.125 308.5 88 311.5 90 314 C 88 318 85.25 322.25 82.125 326.46875 C 79 330.6875 75.5 334.875 72 338.75 C 68.5 342.625 65 346.1875 61.875 349.15625 C 58.75 352.125 56 354.5 54 356 C 54.5 358 54.625 360.125 54.5 362.25 C 54.375 364.375 54 366.5 53.5 368.5 C 53 370.5 52.375 372.375 51.75 374 C 51.125 375.625 50.5 377 50 378 L 120 374 C 137.5 375 151 374.875 161.5 374 C 172 373.125 179.5 371.5 185 369.5 C 190.5 367.5 194 365.125 196.5 362.75 C 199 360.375 200.5 358 202 356 C 203.5 352.5 204.625 349.375 205.4375 346.65625 C 206.25 343.9375 206.75 341.625 207 339.75 C 207.25 337.875 207.25 336.4375 207.0625 335.46875 C 206.875 334.5 206.5 334 206 334 C 205 329 203.875 322.75 202.65625 315.71875 C 201.4375 308.6875 200.125 300.875 198.75 292.75 C 197.375 284.625 195.9375 276.1875 194.46875 267.90625 C 193 259.625 191.5 251.5 190 244 C 189 237.5 187.875 231.5 186.59375 225.96875 C 185.3125 220.4375 183.875 215.375 182.25 210.75 C 180.625 206.125 178.8125 201.9375 176.78125 198.15625 C 174.75 194.375 172.5 191 170 188 L 188 132 C 190 127.5 189.75 123.5 187.78125 120.03125 C 185.8125 116.5625 182.125 113.625 177.25 111.25 C 172.375 108.875 166.3125 107.0625 159.59375 105.84375 C 152.875 104.625 145.5 104 138 104 C 139.5 100 140.625 92.5 141.09375 83.5 C 141.5625 74.5 141.375 64 140.25 54 C 139.125 44 137.0625 34.5 133.78125 27.5 C 130.5 20.5 126 16 120 16 Z  M 54 132 C 50.5 136.5 47.25 143 44.4375 150.84375 C 41.625 158.6875 39.25 167.875 37.5 177.75 C 35.75 187.625 34.625 198.1875 34.3125 208.78125 C 34 219.375 34.5 230 36 240 C 35 245.5 34.625 251.375 34.75 257.28125 C 34.875 263.1875 35.5 269.125 36.5 274.75 C 37.5 280.375 38.875 285.6875 40.5 290.34375 C 42.125 295 44 299 46 302 L 42 314 L 56 308 C 58.5 304.5 60.75 300.125 62.59375 295.125 C 64.4375 290.125 65.875 284.5 66.75 278.5 C 67.625 272.5 67.9375 266.125 67.53125 259.625 C 67.125 253.125 66 246.5 64 240 C 65.5 234 66.875 227.875 68.21875 222.03125 C 69.5625 216.1875 70.875 210.625 72.25 205.75 C 73.625 200.875 75.0625 196.6875 76.65625 193.59375 C 78.25 190.5 80 188.5 82 188 Z  M 188 132 C 190.5 136.5 192.875 143 194.9375 150.84375 C 197 158.6875 198.75 167.875 200 177.75 C 201.25 187.625 202 198.1875 202.0625 208.78125 C 202.125 219.375 201.5 230 200 240 C 201 245.5 202.125 251.375 203.125 257.28125 C 204.125 263.1875 205 269.125 205.5 274.75 C 206 280.375 206.125 285.6875 205.625 290.34375 C 205.125 295 204 299 202 302 L 206 314 L 198 308 C 196 304.5 194.125 300.125 192.46875 295.125 C 190.8125 290.125 189.375 284.5 188.25 278.5 C 187.125 272.5 186.3125 266.125 185.90625 259.625 C 185.5 253.125 185.5 246.5 186 240 C 187.5 234 188.25 227.875 188.28125 222.03125 C 188.3125 216.1875 187.625 210.625 186.25 205.75 C 184.875 200.875 182.8125 196.6875 180.09375 193.59375 C 177.375 190.5 174 188.5 170 188 Z  M 90 314 C 89.5 317 88.875 321.125 88.0625 326.09375 C 87.25 331.0625 86.25 336.875 85 343.25 C 83.75 349.625 82.25 356.5625 80.4375 363.78125 C 78.625 371 76.5 378.5 74 386 C 70 393.5 66.625 401 63.78125 408.4375 C 60.9375 415.875 58.625 423.25 56.75 430.5 C 54.875 437.75 53.4375 444.875 52.34375 451.8125 C 51.25 458.75 50.5 465.5 50 472 C 49.5 477.5 48.5 483.125 47.3125 488.46875 C 46.125 493.8125 44.75 498.875 43.5 503.25 C 42.25 507.625 41.125 511.3125 40.4375 513.90625 C 39.75 516.5 39.5 518 40 518 L 66 518 L 72 512 L 68 504 C 69 500 70.125 495.375 71.34375 490.5 C 72.5625 485.625 73.875 480.5 75.25 475.5 C 76.625 470.5 78.0625 465.625 79.53125 461.25 C 81 456.875 82.5 453 84 450 C 85.5 446 87.125 441.875 88.875 437.71875 C 90.625 433.5625 92.5 429.375 94.5 425.25 C 96.5 421.125 98.625 417.0625 100.875 413.15625 C 103.125 409.25 105.5 405.5 108 402 C 110 398 112 393.625 113.84375 389.15625 C 115.6875 384.6875 117.375 380.125 118.75 375.75 C 120.125 371.375 121.1875 367.1875 121.78125 363.46875 C 122.375 359.75 122.5 356.5 122 354 C 122 351 121.875 347.875 121.59375 344.71875 C 121.3125 341.5625 120.875 338.375 120.25 335.25 C 119.625 332.125 118.8125 329.0625 117.78125 326.15625 C 116.75 323.25 115.5 320.5 114 318 Z  M 150 314 C 150.5 317 151.125 321.125 151.9375 326.09375 C 152.75 331.0625 153.75 336.875 155 343.25 C 156.25 349.625 157.75 356.5625 159.5625 363.78125 C 161.375 371 163.5 378.5 166 386 C 170 393.5 173.375 401 176.21875 408.4375 C 179.0625 415.875 181.375 423.25 183.25 430.5 C 185.125 437.75 186.5625 444.875 187.65625 451.8125 C 188.75 458.75 189.5 465.5 190 472 C 190.5 477.5 191.5 483.125 192.6875 488.46875 C 193.875 493.8125 195.25 498.875 196.5 503.25 C 197.75 507.625 198.875 511.3125 199.5625 513.90625 C 200.25 516.5 200.5 518 200 518 L 174 518 L 168 512 L 172 504 C 171 500 169.875 495.375 168.65625 490.5 C 167.4375 485.625 166.125 480.5 164.75 475.5 C 163.375 470.5 161.9375 465.625 160.46875 461.25 C 159 456.875 157.5 453 156 450 C 154.5 446 152.875 441.875 151.125 437.71875 C 149.375 433.5625 147.5 429.375 145.5 425.25 C 143.5 421.125 141.375 417.0625 139.125 413.15625 C 136.875 409.25 134.5 405.5 132 402 C 130 398 128 393.625 126.15625 389.15625 C 124.3125 384.6875 122.625 380.125 121.25 375.75 C 119.875 371.375 118.8125 367.1875 118.21875 363.46875 C 117.625 359.75 117.5 356.5 118 354 C 118 351 118.125 347.875 118.40625 344.71875 C 118.6875 341.5625 119.125 338.375 119.75 335.25 C 120.375 332.125 121.1875 329.0625 122.21875 326.15625 C 123.25 323.25 124.5 320.5 126 318 Z"
  });

  /*
   * Contornos musculares por região e vista. Coordenadas no espaço da prancha
   * (240 × 520). Regiões sem entrada para a vista não são pintadas nessa vista.
   */
  var REGIONS = {
    ombros: {
      label: "Ombros",
      front: [
        "M60 132 Q68 140 84 174 L90 162 Q76 140 68 136 Z",
        "M180 132 Q172 140 156 174 L150 162 Q164 140 172 136 Z"
      ],
      back: [
        "M60 136 Q66 154 88 188 L92 168 Q80 144 68 140 Z",
        "M180 136 Q174 154 152 188 L148 168 Q160 144 172 140 Z"
      ]
    },
    peito: {
      label: "Peitoral",
      front: [
        "M118 138 Q98 144 88 166 L94 198 Q108 176 118 168 Z",
        "M122 138 Q142 144 152 166 L162 198 Q148 176 138 168 Z"
      ]
    },
    biceps: {
      label: "B\u00edceps",
      front: [
        "M84 172 Q82 194 76 220 L72 228 Q70 236 74 232 Q78 222 82 204 Z",
        "M156 172 Q158 194 164 220 L168 228 Q170 236 166 232 Q162 222 158 204 Z"
      ]
    },
    antebracos: {
      label: "Antebra\u00e7os",
      front: [
        "M74 232 Q76 254 70 284 Q68 294 64 292 L62 300 Q66 296 64 286 Q66 268 70 254 Z",
        "M166 232 Q164 254 170 284 Q172 294 176 292 L178 300 Q174 296 176 286 Q174 268 170 254 Z"
      ],
      back: [
        "M54 230 Q50 254 46 282 Q48 290 52 288 L58 296 Q60 292 56 284 Q54 262 56 244 Z",
        "M186 230 Q190 254 194 282 Q192 290 188 288 L182 296 Q180 292 184 284 Q186 262 184 244 Z"
      ]
    },
    abdomem: {
      label: "Abd\u00f4men",
      front: [
        "M104 172 Q106 190 104 204 L116 204 Q116 190 114 172 Z",
        "M104 206 Q106 224 104 238 L116 238 Q116 224 114 206 Z",
        "M104 240 Q106 252 104 264 L116 264 Q116 252 114 240 Z",
        "M124 172 Q126 190 124 204 L136 204 Q136 190 126 172 Z",
        "M124 206 Q126 224 124 238 L136 238 Q136 224 126 206 Z",
        "M124 240 Q126 252 124 264 L136 264 Q136 252 126 240 Z",
        "M118.5 172 L121.5 266 L121 268 L119 174 Z"
      ]
    },
    obliquos: {
      label: "Obl\u00edquos",
      front: [
        "M80 186 Q88 206 96 234 L102 258 Q94 266 86 272 L80 254 Q84 226 80 202 Z",
        "M160 186 Q152 206 144 234 L138 258 Q146 266 154 272 L160 254 Q156 226 160 202 Z"
      ]
    },
    quadril: {
      label: "Quadril",
      front: [
        "M82 256 Q88 268 98 274 L158 274 Q152 268 148 256 Z",
        "M98 274 Q94 290 100 302 Q104 292 102 282 Z",
        "M158 274 Q162 290 156 302 Q152 292 154 282 Z",
        "M70 258 Q62 282 50 302 L56 320 Q64 312 72 306 Z",
        "M170 258 Q178 282 190 302 L184 320 Q176 312 168 306 Z"
      ]
    },
    quadriceps: {
      label: "Quadr\u00edceps",
      front: [
        "M48 302 Q54 324 58 366 Q62 402 66 416 L72 424 Q78 420 80 410 Q82 378 74 344 Q70 314 60 308 Z",
        "M192 302 Q186 324 182 366 Q178 402 174 416 L168 424 Q162 420 160 410 Q158 378 166 344 Q170 314 180 308 Z"
      ]
    },
    pernas: {
      label: "Pernas",
      front: [
        "M60 424 Q58 446 56 476 Q58 476 54 472 L54 472 Q52 456 54 446 Z",
        "M180 424 Q182 446 184 476 Q182 476 186 472 L186 472 Q188 456 186 446 Z",
        "M40 510 Q36 516 36 518 L44 518 Q42 506 40 504 Q38 506 38 510 Z",
        "M192 510 Q194 516 194 518 L202 518 Q198 506 196 504 Q192 506 192 510 Z"
      ],
      back: [
        "M72 360 Q66 388 64 416 Q64 426 70 430 L78 434 Q84 448 86 478 Q82 494 78 490 L74 494 Q70 484 72 482 Z",
        "M168 360 Q174 388 176 416 Q176 426 170 430 L162 434 Q156 448 154 478 Q158 494 162 490 L166 494 Q170 484 168 482 Z",
        "M52 510 Q44 516 40 518 L58 518 Q62 506 60 504 Q60 506 60 510 Z",
        "M182 510 Q188 516 192 518 L188 518 Q184 506 182 504 Q182 506 182 510 Z"
      ]
    },
    costas: {
      label: "Costas",
      back: [
        "M90 130 Q96 156 104 190 L108 206 Q116 196 120 194 L116 174 Q110 164 106 154 Z",
        "M150 130 Q144 156 136 190 L132 206 Q124 196 120 194 L124 174 Q130 164 134 154 Z"
      ]
    },
    dorsais: {
      label: "Dorsais",
      back: [
        "M82 176 Q74 218 72 254 L70 284 Q78 270 84 256 L90 238 Q86 206 84 188 Z",
        "M158 176 Q166 218 168 254 L170 284 Q162 270 156 256 L150 238 Q154 206 156 188 Z"
      ]
    },
    lombar: {
      label: "Lombar",
      back: [
        "M104 252 Q108 276 112 298 L128 298 Q132 276 136 252 Z"
      ]
    },
    triceps: {
      label: "Tr\u00edceps",
      back: [
        "M60 152 Q56 180 52 206 Q50 220 54 230 L58 228 Q62 216 60 202 Q62 186 60 166 Z",
        "M180 152 Q184 180 188 206 Q190 220 186 230 L182 228 Q178 216 180 202 Q178 186 180 166 Z"
      ]
    },
    gluteos: {
      label: "Gl\u00fatos",
      back: [
        "M64 296 Q60 328 62 356 L68 378 Q78 364 88 350 Q84 324 74 304 Z",
        "M176 296 Q182 328 178 356 L172 378 Q162 364 152 350 Q156 324 166 304 Z"
      ]
    },
    "posterior-coxa": {
      label: "Posterior de coxa",
      back: [
        "M72 360 Q66 388 64 416 Q64 426 70 430 L78 434 Q84 448 86 478 Q82 494 78 490 L74 494 Q70 484 72 482 Z",
        "M168 360 Q174 388 176 416 Q176 426 170 430 L162 434 Q156 448 154 478 Q158 494 162 490 L166 494 Q170 484 168 482 Z"
      ]
    },
    panturrilha: {
      label: "Panturrilha",
      back: [
        "M90 428 Q84 454 80 482 Q88 482 84 476 L84 476 Q78 470 76 464 Z",
        "M70 440 Q74 464 76 488 L80 484 Q76 468 72 444 Z",
        "M150 428 Q156 454 160 482 Q152 482 156 476 L156 476 Q162 470 164 464 Z",
        "M170 440 Q166 464 164 488 L160 484 Q164 468 168 444 Z"
      ]
    }
  };

  function shapesFor(regionId, view) {
    var region = REGIONS[regionId];
    if (!region) return null;

    if (view === "back") {
      if (region.back && region.back.length) return region.back;
      if (region.both && region.both.length) return region.both;
      return null;
    }

    if (region.front && region.front.length) return region.front;
    if (region.both && region.both.length) return region.both;
    return null;
  }

  function regionsInView(view) {
    return Object.keys(REGIONS).filter(function (id) {
      return Boolean(shapesFor(id, view));
    });
  }

  function svg(tag, attrs) {
    var node = doc.createElementNS(NS, tag);
    var key;
    for (key in attrs || {}) {
      if (Object.prototype.hasOwnProperty.call(attrs || {}, key)) {
        node.setAttribute(key, String(attrs[key]));
      }
    }
    return node;
  }

  /*
   * Monta a figura anat\u00f4mica.
   *
   * options:
   *   view        "front" | "back"
   *   highlights  { regi\u00e3oId: "primary" | "secondary" | "stabilizer" | "informed" | "focus" }
   *   interactive opcional; quando verdadeiro, as regi\u00f5es ganham foco e clique
   *   onSelect    (regi\u00e3oId) => void, usado com `interactive`
   *   selected    regi\u00e3o marcada como pressionada (para leitura por teclado)
   *   label       texto alternativo; quando ausente \u00e9 gerado a partir do destaque
   *   compact     modo enxuto usado na execu\u00e7\u00e3o do treino
   */
  function render(options) {
    var settings = Object.assign({ view: "front", highlights: {}, interactive: false }, options || {});
    var view = settings.view === "back" ? "back" : "front";
    var highlights = settings.highlights || {};
    var silhouettePath = SILHOUETTES[view];

    clipCounter += 1;
    var clipId = "figura-clip-" + clipCounter;

    var wrapper = doc.createElement("div");
    wrapper.className = "figura figura-" + view + (settings.compact ? " is-compact" : "");

    var root = svg("svg", {
      viewBox: "0 0 " + VIEWBOX.width + " " + VIEWBOX.height,
      preserveAspectRatio: "xMidYMid meet",
      class: "figura-svg",
      role: settings.interactive ? "group" : "img",
      "aria-label": settings.label || describe(highlights, view)
    });

    var defs = svg("defs", {});
    var clip = svg("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
    clip.appendChild(svg("path", { d: silhouettePath }));
    defs.appendChild(clip);
    root.appendChild(defs);

    /* Silhueta base sutil sob a prancha anat\u00f4mica: garante contraste e fallback imediato. */
    var silhouette = svg("g", { class: "figura-silhouette" });
    silhouette.appendChild(svg("path", { class: "figura-silhouette-bg", d: silhouettePath }));
    root.appendChild(silhouette);

    /* Prancha anat\u00f4mica detalhada de refer\u00eancia (2\u00d7 Retina 480\u00d71040 sobre 240 \u00d7 520). */
    root.appendChild(svg("image", {
      class: "figura-plate",
      href: PLATES[view],
      x: 0,
      y: 0,
      width: VIEWBOX.width,
      height: VIEWBOX.height,
      preserveAspectRatio: "xMidYMid meet",
      "clip-path": "url(#" + clipId + ")"
    }));

    var regionLayer = svg("g", { class: "figura-regions", "clip-path": "url(#" + clipId + ")" });

    var roleRank = { informed: 0, stabilizer: 1, secondary: 2, primary: 3, focus: 4 };
    var ordered = Object.keys(REGIONS)
      .filter(function (regionId) {
        return highlights[regionId] && shapesFor(regionId, view);
      })
      .sort(function (a, b) {
        return (roleRank[highlights[a]] || 0) - (roleRank[highlights[b]] || 0);
      });

    ordered.forEach(function (regionId) {
      var shapes = shapesFor(regionId, view);
      var role = highlights[regionId];

      var group = svg("g", {
        class: "figura-region is-" + role,
        "data-region": regionId,
        "data-role": role
      });

      var focused = settings.selected === regionId;

      if (settings.interactive) {
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");
        group.setAttribute("aria-pressed", focused ? "true" : "false");
        group.setAttribute(
          "aria-label",
          REGIONS[regionId].label + ", " + (ROLE_NAMES[role] || role) + (focused ? ", selecionada" : "") + ". " + VIEWS[view] + "."
        );
        group.setAttribute("data-figura-focus", regionId);

        var activate = function () {
          if (typeof settings.onSelect === "function") settings.onSelect(regionId);
        };

        group.addEventListener("click", activate);
        group.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            activate();
          }
        });
      }

      shapes.forEach(function (pathData) {
        group.appendChild(svg("path", { class: "figura-region-shape", d: pathData }));
      });

      if (settings.interactive) {
        shapes.forEach(function (pathData) {
          group.appendChild(svg("path", { class: "figura-region-hit", d: pathData }));
        });
      }

      regionLayer.appendChild(group);
    });

    root.appendChild(regionLayer);
    wrapper.appendChild(root);
    return wrapper;
  }

  /*
   * Texto alternativo do destaque. Lista apenas as regi\u00f5es visíveis na vista
   * solicitada.
   */
  function describe(highlights, view) {
    var levels = { primary: [], secondary: [], stabilizer: [], informed: [], focus: [] };
    var current = view === "back" ? "back" : "front";

    Object.keys(highlights || {}).forEach(function (regionId) {
      var role = highlights[regionId];
      if (!levels[role]) return;
      var reg = REGIONS[regionId];
      if (!shapesFor(regionId, current)) return;
      levels[role].push((reg || {}).label || regionId);
    });

    var parts = [];

    if (levels.primary.length) parts.push("principal: " + levels.primary.join(", "));
    if (levels.secondary.length) parts.push("secund\u00e1ria: " + levels.secondary.join(", "));
    if (levels.stabilizer.length) parts.push("estabilizadora: " + levels.stabilizer.join(", "));
    if (levels.informed.length) parts.push("informada por voc\u00ea: " + levels.informed.join(", "));
    if (levels.focus.length) parts.push("em foco: " + levels.focus.join(", "));

    var viewLabel = current === "back" ? "Silhueta humana, vista posterior" : "Silhueta humana, vista anterior";

    return parts.length ? viewLabel + ". " + parts.join(". ") + "." : viewLabel + ", nenhuma regi\u00e3o destacada.";
  }

  window.Forja = window.Forja || {};
  window.Forja.figura = {
    VIEWS: VIEWS,
    VIEWBOX: VIEWBOX,
    ROLE_NAMES: ROLE_NAMES,
    REGIONS: REGIONS,
    render: render,
    describe: describe,
    regionsInView: regionsInView,
    shapesFor: shapesFor
  };
})(window);
