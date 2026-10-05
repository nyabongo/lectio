# Lectionary disputes: block `seasonal-weekdays`

Written by `npm run lectionary:crosscheck -- --block seasonal-weekdays`. Do not edit by hand; fix the data or
`calendar/lectionary/crosscheck/seasonal-weekdays.json` and run it again.

- Readings compared with a second source: 338
- Agreements: 332
- Disagreements: 6
- Single-source readings: 23

## Disagreements

- `proper-of-time:advent-weekday-1-mon day first-reading`: ours `Is 2:1-5`, second source `Isaiah 4:2-6`. passage differs: ours IS.2.1-5, theirs IS.4.2-6.
- `celebrations:advent-december-18 day gospel`: ours `Mt 1:18-25`, second source `Mt 1:18-24`. passage differs: ours MT.1.18-25, theirs MT.1.18-24.
- `celebrations:christmas-time-january-5 day first-reading`: ours `1 Jn 3:11-21`, second source `1 John 3:22-24; 4:1-6`. passage differs: ours 1JN.3.11-21, theirs 1JN.3.22-24_4.1-6.
- `celebrations:christmas-time-january-5 day psalm`: ours `Ps 100:1-2, 3, 4, 5`, second source `Psalm 2:7bc-8, 10-12a`. passage differs: ours PS.100.1-2_100.3_100.4_100.5, theirs PS.2.7-8_2.10-12.
- `celebrations:christmas-time-january-5 day gospel`: ours `Jn 1:43-51`, second source `Matthew 4:12-17, 23-25`. passage differs: ours JN.1.43-51, theirs MT.4.12-17_4.23-25.
- `proper-of-time:easter-weekday-4-mon day gospel`: ours `Jn 10:1-10`, second source `John 10:11-18`. passage differs: ours JN.10.1-10, theirs JN.10.11-18.

## Single-source readings

No independent second source covers these readings yet. They stay `provisional` until a person checks them
against the Kenyan _Lectionary_ (docs/decisions/011-lectionary-source.md).

- `celebrations:christmas-octave-day-6`: day first-reading `1 Jn 2:12-17`; day psalm `Ps 96:7-8, 8-9, 10`; day gospel `Lk 2:36-40`. Source: `olm-1981 p?#203`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayDec30 (empty at the pinned revision, as are la.json and it.json)`.
- `celebrations:christmas-octave-day-7`: day first-reading `1 Jn 2:18-21`; day psalm `Ps 96:1-2, 11-12, 13`; day gospel `Jn 1:1-18`. Source: `olm-1981 p?#204`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayDec31 (empty at the pinned revision, as are la.json and it.json)`.
- `celebrations:christmas-time-january-2`: day first-reading `1 Jn 2:22-28`; day psalm `Ps 98:1, 2-3, 3-4`; day gospel `Jn 1:19-28`. Source: `olm-1981 p?#205`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayJan2 (empty at the pinned revision, as are la.json and it.json)`.
- `celebrations:christmas-time-january-4`: day first-reading `1 Jn 3:7-10`; day psalm `Ps 98:1, 7-8, 9`; day gospel `Jn 1:35-42`. Source: `olm-1981 p?#207`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayJan4 (empty at the pinned revision, as are la.json and it.json)`.
- `celebrations:christmas-time-january-6`: day psalm `Ps 147:12-13, 14-15, 19-20`. Source: `olm-1981 p?#209`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayJan6 (psalm given only as the whole "Psalm 147", no verses)`.
- `celebrations:christmas-time-january-7`: day psalm `Ps 149:1-2, 3-4, 5-6, 9`. Source: `olm-1981 p?#210`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#ChristmasWeekdayJan7 (psalm given only as the whole "Psalm 149", no verses)`.
- `celebrations:friday-after-epiphany`: day psalm `Ps 147:12-13, 14-15, 19-20`. Source: `olm-1981 p?#216`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanyFriday (psalm given only as the whole "Psalm 147", no verses)`.
- `celebrations:monday-after-epiphany`: day psalm `Ps 2:7-8, 10-12`. Source: `olm-1981 p?#212`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanyMonday (psalm given only as the whole "Psalm 2", no verses)`.
- `celebrations:saturday-after-epiphany`: day psalm `Ps 149:1-2, 3-4, 5-6, 9`. Source: `olm-1981 p?#217`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanySaturday (psalm given only as the whole "Psalm 149", no verses)`.
- `celebrations:thursday-after-epiphany`: day psalm `Ps 72:1-2, 14, 15, 17`. Source: `olm-1981 p?#215`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanyThursday (psalm given only as the whole "Psalm 71 (72)", no verses)`.
- `celebrations:tuesday-after-epiphany`: day psalm `Ps 72:1-2, 3-4, 7-8`. Source: `olm-1981 p?#213`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanyTuesday (psalm given only as the whole "Psalm 71 (72)", no verses)`.
- `celebrations:wednesday-after-epiphany`: day psalm `Ps 72:1-2, 10, 12-13`. Source: `olm-1981 p?#214`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_nativitatis/en.json#DayAfterEpiphanyWednesday (psalm given only as the whole "Psalm 71 (72)", no verses)`.
- `proper-of-time:advent-weekday-1-mon`: day first-reading (A) `Is 4:2-6`. Source: `olm-1981 p?#175`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_adventus/en.json#AdventWeekday1Monday (one reading for every year, compared with the OLM reading; no second source for the Year A substitute first reading Is 4:2-6)`.
- `proper-of-time:lent-weekday-5-mon`: day gospel (C) `Jn 8:12-20`. Source: `olm-1981 p?#251`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_quadragesimae/en.json#LentWeekday5Monday (one reading for every year, compared with the OLM reading; no second source for the Year C substitute gospel Jn 8:12-20)`.
- `proper-of-time:easter-weekday-4-mon`: day gospel (A) `Jn 10:11-18`. Source: `olm-1981 p?#279`. Consulted without result: `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 feriale_tempus_paschatis/en.json#EasterWeekday4Monday (one reading for every year, compared with the OLM reading; no second source for the Year A substitute gospel Jn 10:11-18)`.
