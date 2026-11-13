# Licence and Data Access Check

Checked 2026-11-12. Tooling note: pages were read with a fetch tool that summarises content, so quoted wording marked "(summarised)" should be re-read on the page before it goes into the repo. KMA API Hub pages were read as rendered text (browser fetch) and one PDF was rendered to an image and read directly.

## 1. OpenAP licence

**Answer: LGPL-3.0 (GNU Lesser General Public License v3). Importing it as a dependency is compatible with distributing our own code under Apache-2.0, provided we do not copy or modify OpenAP source into our repo.**

Evidence
- PyPI JSON metadata for openap 2.6.2: `license: GNU LGPL v3`, classifier `License :: OSI Approved :: GNU Lesser General Public License v3 (LGPLv3)`. https://pypi.org/pypi/openap/json (primary; read).
- GitHub README badge "License: LGPL v3" and About panel "LGPL-3.0 license". https://github.com/junzis/openap (primary; read, summarised).
- Repo LICENSE file begins "GNU LESSER GENERAL PUBLIC LICENSE Version 3, 29 June 2007". https://raw.githubusercontent.com/junzis/openap/master/LICENSE (primary; read, summarised).
- Dependencies on PyPI: numpy, pandas, pyyaml, scipy (core); casadi, jax, matplotlib only as extras.

Compatibility reasoning (my analysis, not from a source I read; the LGPL text itself was not read in full)
- LGPL is a weak copyleft intended to allow use as a library by code under other licences. Our Apache-2.0 code that only does `import openap` and lists it in `requirements`/`pyproject` does not become LGPL. The LGPL obligations apply to OpenAP itself: if we ship OpenAP (vendored, bundled in a Docker image or a frozen app), we must give its licence text and notice, allow replacement of the library, and release any modifications to OpenAP under LGPL.
- Apache-2.0 is one-way compatible with GPLv3/LGPLv3 for combined works, so there is no conflict for a combined deployed service. Not legal advice.

Options
1. Keep it as a normal `pip` dependency (not vendored, not modified). Mention LGPL-3.0 in a NOTICE/third-party list. Lowest effort.
2. Make it an optional extra (`pip install aeroicing-watch[openap]`) with a fallback if the physics we need is simple.
3. Remove it and implement the few formulas needed ourselves from published papers; do not copy OpenAP code or data files (the data files' licence was not checked).

Unverified
- OpenAP's data files (aircraft/engine parameters) may carry separate terms; not checked.
- Whether the Devpost judges treat a copyleft dependency as an issue: not stated in anything I read.

## 2. GK-2A ICING and CTPS on KMA API Hub

**Answer: Yes for the product list, partly for the details. ICING (착빙) and CTPS (운정산출물) are both listed as GK-2A Level-2 products on the API Hub satellite page. Per-area availability of ICING (KO/EA/FD) and its exact cadence could not be confirmed without an API key.**

Confirmed from the primary page (https://apihub.kma.go.kr/apiList.do?seqApi=6, read as rendered text)
- The page lists "ICING - 착빙" and "CTPS - 운정산출물(운상, 운정온도/고도/기압)" among the GK-2A L2 product codes (section 3, 기상산출물 조회). Download URL pattern: `/api/typ05/api/GK2A/LE2/{product}/{area}/data?date=YYYYMMDDHHMM`. Area values accepted by that API: FD, EA, ELA, KO. The listing is generic for all products; it does not say which products exist for which area.
- Section 3 (the legacy product API) is marked "'27.3. 서비스 종료예정" (service ends March 2027). A newer API replaces it: `sat_file_nc_down.php?lvl=l2&data=...&area=...&tm=YYYYMMDDHHMM` (example in the page uses `data=ctps-aux&area=fd`), plus `sat_file_data_list.php` and `sat_meta_list.php`. The new API takes lower-case area codes `fd, ea, ela, ko`. `sat_meta_list.php` (needs authKey) returns per-product flags `areaFD/areaEA/areaELA/areaKO`, production cycles and `apiNC` availability. I could not call it, so I did not see whether ICING exists in the new API or its data name (likely `icing`, unconfirmed).
- File format: NetCDF for data files (`apiNC`), PNG for images. Page-level cadence: FD and EA every 10 min on the hour, KO every 2 min (this is the platform-wide statement, not per product). Archive from July 2019.
- CTPS: the page lists CTPS as a product and the area parameter accepts EA, but it does not show a product-by-area matrix. The page's own example for the new API uses `ctps-aux` with area `fd`, which suggests CTPS exists for FD at least. CTPS for EA specifically: not confirmed.
- Account limits (https://apihub.kma.go.kr/apiInfo.do): registration and an authKey are required; general members 20,000 calls and 5 GB per day, institutional members 30,000 calls and 50 GB per day. Keys may not be lent or transferred. API use is free.

Unverified
- ICING areas (KO / EA / FD) and ICING cadence. Check by calling `sat_meta_list.php?disp=1&authKey=...` and reading the ICING row.
- CTPS for EA (same call).
- Whether ICING is still delivered after the legacy API ends in March 2027.
- NMSC's own product documentation (the NMSC site returned an error page; the Weather Act and ATBD documents were not opened).

## 3. Reuse and redistribution terms for KMA / NMSC data

**Answer: KMA data is open under KOGL (Korea Open Government Licence). For the GK-2A basic observation NetCDF set, the Public Data Portal states "공공저작물: 출처표시 (제1유형)", i.e. KOGL Type 1: free use including commercial use and derivative works, with attribution. A revised Weather Act in force since 2026-09-18 makes source attribution mandatory when publishing or passing on weather data, including information derived from it; the penalty is an administrative fine of up to KRW 500,000. Publishing derived JSON profiles in a public repo and a public demo is therefore allowed provided each carries a source line. Redistribution of the raw files was not shown to be restricted, but I would still publish only derived or small sample data.**

Evidence
- KMA API Hub guidance page: "기상청 API허브를 통해 제공하는 기상기후데이터는 공공누리 적용을 받습니다. 공공누리 유형별 이용조건에 따라 이용 가능합니다." API is free. https://apihub.kma.go.kr/apiInfo.do (primary; read).
- Public Data Portal entry for GK-2A basic observation NetCDF: 이용허락범위 "공공저작물 : 출처표시 (제 1유형)", cost free. https://www.data.go.kr/data/15043598/fileData.do (primary listing for that dataset; read). This covers the L1B dataset only. I did not find a licence line for the L2 ICING/CTPS data specifically.
- KMA copyright page: KOGL Type 1 material may be used freely "별도의 이용허락 없이", and "이용자께서는 반드시 저작물의 출처를 구체적으로 표시하여야 합니다". Material that KMA does not fully own (co-owned) must not be modified or redistributed. Types 2-4 have their own limits; items without a KOGL mark need prior agreement. https://www.kma.go.kr/kma/guide/copyright.jsp (primary; read).
- API Hub notice "[공지] 기상기후데이터 사용 시 출처표시 안내", dated 2026-09-14: "2026년 9월 18일 기상법 개정에 따라, 기상기후데이터(이를 활용한 정보 포함)를 공표하거나 제3자 제공하는 경우에는 출처표시를 하여야 합니다." https://apihub.kma.go.kr/notice.do?seqNotice=57 (primary; read).
- Attached guide "기상기후데이터 출처표시 가이드" (one-page PDF, rendered and read): cites 기상법 [시행 2026.9.18., 법률 제21463호, 2026.3.17. 일부개정]; data is free to use "신고나 허락 없이"; attribution is required when publishing or giving to third parties data "(이를 활용한 정보 포함)"; a fine of up to KRW 500,000 ("50만원 이하의 과태료") applies. Applies to web/app screens, reports, broadcast/SNS, and service/API redistribution, including processed data, and whether or not passed through another organisation. Place it where the viewer sees it (under a chart, on the live display, on downloadable files in a header or first sheet). Not valid: only a link or button, using data without any credit, presenting KMA forecasts as your own, or hiding that data was processed. File: https://apihub.kma.go.kr/getFile.do?fileName=%EA%B8%B0%EC%83%81%EA%B8%B0%ED%9B%84%EB%8D%B0%EC%9D%B4%ED%84%B0%20%EC%B6%9C%EC%B2%98%ED%91%9C%EC%8B%9C%20%EA%B0%80%EC%9D%B4%EB%93%9C.pdf

Required attribution wording (from the guide; the guide says the sentences may be used as written)
- Basic: `출처: 기상청` / `자료: 기상청` / `자료 제공: 기상청`
- On screens and graphics: `자료출처 — 기상청(기상자료개방포털)`
- When processed: `기상청 「<dataset name>」를 ○○○이 재가공` (guide's example: 기상청 「종관기상관측(ASOS) 일자료」를 ○○○이 재가공)
- Detailed: `본 저작물은 기상청에서 공공누리 제○유형으로 개방한 「자료명」을 이용하였으며, 기상자료개방포털(data.kma.go.kr)에서 무료로 내려받으실 수 있습니다.`
- Suggested English line for the site (my translation, not an official wording): `Source: Korea Meteorological Administration (KMA) / National Meteorological Satellite Center (NMSC), GK-2A AMI. Processed by AeroIcing Watch.`

Unverified
- The article number. The guide gives the Act and the 2026-09-18 effective date but not "article 12-3"; law.go.kr would not load, so I could not read the article text. The task's reference to article 12-3 is not confirmed by me.
- Whether L2 ICING/CTPS carry KOGL Type 1 specifically (L1B does). NMSC's own terms page returned an error. If the products are a different type, restrictions (for example no commercial use or no derivatives) could differ.
- Whether publishing raw NetCDF files in the repo is acceptable; no explicit statement either way was found. The API Hub terms page ("약관") could not be opened by URL, so the full API Hub terms of service were not read. Check them for any rule on redistributing data obtained with a personal key.
- Whether a hackathon demo counts as "공표" (it almost certainly does; attribute anyway).
- English-language NMSC wording requested by NMSC (some NMSC pages may ask for "NMSC/KMA" credit); not seen.

## 4. ECMWF Open Data (IFS real-time)

**Answer: CC BY 4.0 plus the ECMWF Terms of Use. Redistribution and commercial use are allowed with attribution.**

Evidence
- ECMWF open data page: governed by the Creative Commons CC-BY-4.0 licence and the ECMWF Terms of Use; data "may be redistributed and used commercially, subject to appropriate attribution" (summarised). Separate Service Charges may apply to delivery services (not to the open data itself). https://www.ecmwf.int/en/forecasts/datasets/open-data (primary; read, summarised).
- ECMWF general licence page (summarised, from the fetch tool): "ECMWF must be acknowledged (attributed) as the source"; attribution must be displayed prominently; users must remove attribution if ECMWF asks. https://apps.ecmwf.int/datasets/licences/general/ (primary; read, summarised).

Required wording (from the licence page, as returned by the fetch tool; re-check the exact text before shipping)
- For data products: `Copyright © [year] European Centre for Medium-Range Weather Forecasts (ECMWF)`, `Source: www.ecmwf.int`, `This data is published under a Creative Commons Attribution 4.0 International (CC BY 4.0)`, the disclaimer `ECMWF does not accept any liability whatsoever for any error or omission in the data, their availability, or for any loss or damage arising from their use`, and a note if the material has been modified.
- For a service built on the data (our case): `This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF)`, plus Source www.ecmwf.int, the CC BY 4.0 statement, the disclaimer, and a modification note.
- For JSON profiles we derive: add "Modified by AeroIcing Watch (interpolated along the route)" or similar.

Unverified
- The ECMWF Terms of Use page (ecmwf.int/en/about/terms-use) returned 404; the Confluence open-data page also returned 404. The exact wording above comes from a summarised fetch of the licence page.
- The legal status of the CC BY 4.0 URL link (https://creativecommons.org/licenses/by/4.0/) was not fetched.

## Action list

1. Run `sat_meta_list.php?disp=1&authKey=<key>` once and record the ICING and CTPS rows (areas, cycle, NetCDF flag). Decide the area (KO vs EA) from that, not from assumption.
2. Plan the move to the new `sat_file_nc_down.php` API now; the legacy `typ05` API ends March 2027.
3. Add the attribution strings above to the UI footer, to every chart caption, to the README, and into the header or metadata of every published JSON profile (`source`, `modified_by`, `licence` fields). Use the KMA line in Korean as well as English.
4. Open the API Hub terms ("약관") and the NMSC data policy while logged in; confirm KOGL type for L2 ICING/CTPS and any limit on republishing raw files. Do not commit raw NetCDF files until confirmed; commit derived JSON only.
5. Do not commit the authKey; keep it in an environment variable. Keys may not be shared, so the demo site must not expose it.
6. Add a NOTICE or THIRD_PARTY file: OpenAP (LGPL-3.0, used as unmodified dependency), KMA/NMSC (KOGL Type 1), ECMWF (CC BY 4.0).
7. Decide on OpenAP: keep as optional dependency (recommended) or remove.
8. Have the project owner state in the Devpost form that the data use is authorised under KOGL Type 1 and CC BY 4.0, linking to the sources above.
