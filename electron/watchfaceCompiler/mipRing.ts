import { inflateSync } from "node:zlib";

/**
 * The black 2 px circle COROS draws round every background after `OptimizeBitmap`
 * (`AggRender::ToBackground` → `DrawCircleOutline(w/2, h/2, w/2, h/2, 2, black)`, AGG's
 * `rasterizer_outline_aa`). Its anti-aliased coverage, one byte per pixel, measured by running
 * COROS 4.9.9's own code for each memory-in-pixel screen size (zlib, base64). AGG covers a few
 * pixels twice; `again` lists those second covers by pixel index.
 */
const RINGS: Readonly<Record<number, { cover: string; again: readonly (readonly [number, number])[] }>> = {
  240: {
    cover:
      "eNrtnXtQVccdxxcrRhMDaaKgxChq4xhJjCC2aoxeRFGLtloFq0HxjU8Q0YtajWJGIei0gkIbnVCNjypWJlWbCkoIUbQJKIrYjhcC" +
      "AWwZHhkbjGWIDt8eQKuS6+U+zj13d39+/9DDvbu/PR84Z3d/+/gtY3aX7+LtR3LKYVK15/ZGBfZhomvA7ISchvtIFReO7lg51X/k" +
      "UJ/X+3l6dHXt5NZ/WGBI+Kad+0+er2lJcifv4AadoKhuc2PP3GqmKNwXPfNtTyeTqbv5LUlIb3kG6k+vGy4arJc+q/neS1Kj/V3N" +
      "z+Y6dE7c5aZ8dSdW+woDq4svVG658WTMpO7WZHcPTipsfqUPT+Gf1SUopUq516qUoE62mOkRssfQhJw8mmva4XvuNr2v8arUOX30" +
      "uYqx4lhvTmGdF11Q7i9L76WeyUHbmv7KeWt780frnVgHVMe/pnplkFSrIB8ewRXsM7MylZv6dLZ9rE8+eA84PYkf3DXVwO1EH/sV" +
      "8Gyc8vB8GcoH7Qqlm3AxrIN9C+mkLwOKIts7nHbBDeDcLzQpKR/45j1nh9KGXAVyg7UqbapSS1QscBztyi+A65q+VX7HgGwH9UF8" +
      "ld/2V2FalxpaAuzzdABujOINRDDHFNy4UetCxypuTMIzjnmw+nwEGN7RssSOu4BL/o6rOMbkAGkemhU3vRTY7NhmcHElaqZrU1T/" +
      "g8AZH+ZgdUoDkp00KCioDvURjANFAgWj7F7KFiDVk3EhX8X/tHNF/eLHwFp+HJV4IL2fHe3rilEVyJMjOrEU9SH284SAjJ58DTO4" +
      "HADW28d0373Abxl3Wgj83h52B5WgcQ7jUDMacep51a2OqEH+YMal3irDFbXHzcbXI9WZcaqe51EboG4nA/iQ8SunI8B8Fe3NVZwh" +
      "xrV2ADGqGQsHtjLOFQFsUsnUeq76VE9SqFoNcSywnAmg+YBeBTOKax/KhFAYsMpmIxuBqUwQLQPCbTSxBPg1E0ZKpbXUJgPTgBVM" +
      "IEUBi2zx/9Rs1TRRNDDP6sxe1Uhmguk3gLXTsm7XcYwJp2QYuliVsV02spiAysAnVuU7jmtdROTt/rVVnf138S83JqRGAcsszjQB" +
      "CGSCagFgqTv8UploLdGjeh+VvS19ef/KBFYaPrcovR7f9BSZt3MBUixI7ieQk2BcQ4CJ5v92DIhjgmsDDGaPLx5CJhNen5ndF47A" +
      "d6+Kz+sNTDYrYbfbCGISaC1KzFqDnYJUJoUy8YEZqcYDr8rB+wYwre1UedjAJNFqlLc5kRaNq0wapbc5C+R5F5Pk4R0IDGyr6T3A" +
      "JFIS/mTy+ymo7yETb/cGmFwGeB1RTCptMtlVXGmhG8W/2t80NV/wNX4lGS9bioInfrcMF5l0yn/yDEkRpsvHG4TKJ6zTDkMuk1AZ" +
      "2GL8i38gREZeHRqNtrHzcIVJqUzjw9EFmCMn73SjLsEsXGeSqsiYT3AJC2Xl1ePEDz4biyJZcdkLd/FG68/+KPL8SVvajd2tPnnu" +
      "e/STl/dNNLi07mukM4l1ovVStGxRFpVZp0mtaqeBqPuRzLzs6uOuQbx4C3Es05bHAW9ihNy8Pvj3Iz9NQT6TXIUY8/CHY1gjO+9W" +
      "7HrY+AIvyM47BBX/v54s3TCdEf0Tfg+7W+/KzxuHnQ8ub2CY/Lw/Q9n9q/6oZgR0A/d3R6/AIQq88Q92e/4FcynwjkNO8/9O9fCg" +
      "wNsZaA7iFIA8RkJ50LU813E0eBNbNqAVwocG78zmYbuOaGxHg9cTtcq/P5V1WuGHKmlazbEQ+6nwHkJY01u8mgrvcuxrGqkbS4XX" +
      "BwbGbsGdCi/7Fi/3fcQPll5X4DNF7I0Zluk4gjZjGx3e7Yg+jhl0eJfgg6/Qlw5vAM7ewXN0ePuiFHWMkBoh8bS+ERmA85R4/wb8" +
      "mRLvbiCJEu8q9aIKCaFwYDEl3nnmbrKTRNNBYerooQKBXpR4dcR4fYnx9ifG+wox3h8T43Umxssanj7PT+urp+2RwP2NPpR4dfT8" +
      "BWr+IDV/n9p4DqnxuvX0xmOpjbdTm08hNl9GbT60CF50eANwltp6BmrrVaitR6K23oz9B25keO/Ahdx6UWrrgamt96a2np/afg2W" +
      "D38avC37ccjtt6K2n479Fz0o4LqgsX3zBbH9sFT2O8dge8sFtf3s1OIVkItHQS3eiDvk38H/aDwZavGCyMWDohbvi1w8t4G4LXe8" +
      "voJWJ7gRi8dILt4mtXiq1OLlshm4IS2usXjI1OJdk4tnTi1ePbnzCGQ9b2IYbrU3+gW180SonRdD7jwgauc9sc34u2S4ps/zonZe" +
      "G/slvu8pE67HXYw2mYDYeYuSnaf5Jow4Ro9LqvNSjz466PwEETsPl42DLCM75p13TO08a8WfwDsy4Jp7XjlbibqfiI/rbf7WyEOm" +
      "OyVi6DPzp4g6G8RfgrYBBmezE/sBU8XGHQJMtOhdrxZ7Ddp5JFqU/rjY2zjSLF2R8lKZyPMr76Oyt4VZJgCBouLOB8ZZnOkPqHpN" +
      "TNyRwHIrsh3HtS4i4nYvRYI1+dplI0tE3gx8Yl1Gt+s4Jh5uMgzWPpZe1eIt24m0JYKKDqK1StHAPBuyT4OJ0XkOFQUsssnAEpgc" +
      "r+ZMEcBSG01sFMh1WAaE22xkF0RZihYGrFLBTKx13RVH9CL1qhhaD6zlHzcULdvHVFA4sFWAqkq9SE9zYV2XVDvtADaraC4I+JBj" +
      "WqcjwHxVLY6vxwFnXnF7nUdtgMo2R9Qgn9Nz+0aU44r6rvqgi7g3h0fcGcCp5+1heC8enLDKk9bAbk6c0i5lvMIXrcsBYJ3drOuK" +
      "UflznnAnlsKuiyBf/BiYxQ9uPJCus28R7wGpvfmgHXwB2Gj3UoK/RUMED7iRQMEoDcrxOAiccXhT7JGm1MtO2pQVXKpub9UKLa5B" +
      "jXYDLx13AZfGOI42IAdI03TL8tjLisvk5Bjavh8BhkitS40Bbjqk3lIKvrfRAeUOzgSKwzQfxigB9jloTeu0L4Brmg7mjToLZPs5" +
      "ruIIuQrkBmtV2lTliapY4NiGYeEN4NxbWpS0IB+4tc3xgw4ryoGLYR3sW0gnfRlQFNmB8aA1VcDtRG/7FfByXB3wJUfD/rOUNwuf" +
      "zraP8clKBxanOVuG7p34HVAdr3qsUl1StUJ7mMNwGR0WKf4ZsvQqxpMetM2gmMxbO4DxqeF7GpX7K4xXxQfvpc9VjBXHcjoqer8e" +
      "DUpRKi9UpQQ9a4uZHiF7mv6ytcmjGf/SxRcq94pTMZPcrcnuHpzUnL/x8BQmirz0WU23jJLUaH8LxoZdh8753eWmfHUnVvt2ZkKp" +
      "67TYM3XN0IW7ome+7WnaeezmtyQhvbw5ef3pdcOZoBowOyHnHlpUceHojpUT/EcO9Xm9n6dHV1dnt/7DAkPCN+3cf/LzmpYkd/IO" +
      "btIx0eUbsf1ITjlMqvbc3qhALY7a+h+OwZMG",
    again: [],
  },
  260: {
    cover:
      "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",
    again: [[9918, 230], [57681, 229]],
  },
  280: {
    cover:
      "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" +
      "VSvfGOkaM6T/A7F6hmw=",
    again: [],
  },
};

const decoded = new Map<number, Uint8Array>();

/** Coverage passes for a square background of this size, or none for sizes COROS has no MIP screen for. */
export function mipRingCover(size: number): { cover: Uint8Array; again: readonly (readonly [number, number])[] } | null {
  const ring = RINGS[size];
  if (!ring) return null;
  if (!decoded.has(size)) decoded.set(size, new Uint8Array(inflateSync(Buffer.from(ring.cover, "base64"))));
  return { cover: decoded.get(size)!, again: ring.again };
}
