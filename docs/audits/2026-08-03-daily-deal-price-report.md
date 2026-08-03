# Daily-deal retirement — products whose price the rotator changed

Generated 2026-08-03 as part of the daily-deal metafield cleanup.

**No prices were changed by that cleanup.** This is a report only, so the owner can decide
separately whether any of these should be reset.

## What happened

The `/cron/deal-activator` job ran nightly at 23:59 until 2026-08-02. Each night it:

- set the incoming pick's variant price to its configured `deal_price` (compare-at = MSRP),
- raised the outgoing pick to a computed `vault_price` (default 25% off MSRP), and
- fired a Klaviyo "New deal just dropped" email.

73 products went through that cycle. Their current Shopify prices are whatever the rotator
last set, not a merchandising decision anyone made.

## Products

```

sku	title	status	msrp	deal_price	vault_price_set	activated	vaulted
98033	Will you Eat My Clam	live	16.99	11.89	-	2026-08-02	-
98039	The Tasty Taco	archived	16.99	11.89	15.46	2026-08-01	2026-08-02
98035	My Best Friends Are Balls: The Adventure C	archived	16.99	11.89	15.46	2026-07-31	2026-08-01
99721	Crave Tease Collection (Necklace + Ring) S	archived	204.00	204.00	185.64	2026-07-30	2026-07-31
99616	Dreamgirl Mesh Bralette with Garter & Pant	archived	32.00	32.00	29.12	2026-07-29	2026-07-30
99636	Arcwave Orbit	archived	149.00	149.00	135.59	2026-07-28	2026-07-29
99809	Tenga Geo Coral	archived	37.99	37.99	34.57	2026-07-27	2026-07-28
98396	The Aneros Soaker	archived	19.95	19.95	18.15	2026-07-26	2026-07-27
99750	Strap-On-Me Harness Lingerie Idylle XL Bla	archived	79.99	79.99	72.79	2026-07-25	2026-07-26
97728	Adam & Eve Lilac Point Bullet Vibe	archived	39.99	35.99	36.39	2026-07-24	2026-07-25
95914	Spectrum Essentials Sweet Spot Dual Motor 	archived	69.99	59.99	63.69	2026-07-23	2026-07-24
95912	Spectrum Essentials Rechargeable Silicone 	archived	59.99	49.99	54.59	2026-07-23	2026-07-23
95913	Spectrum Essentials Rechargeable Silicone 	archived	59.99	49.99	54.59	2026-07-21	2026-07-22
94003	Me You Us Ultra Cock 7.5 " Realistic Dildo	archived	59.72	32.85	54.35	2026-07-20	2026-07-21
94019	Me You Us Full Coverage Hood	archived	43.36	23.85	39.46	2026-07-17	2026-07-18
93291	BANG! 7X Pulsing Rechargeable Silicone Bul	archived	49.96	27.48	45.46	2026-07-15	2026-07-16
94362	Prowler RED Assless Jock Strap Yellow 2XL	archived	12.68	8.88	11.54	2026-07-13	2026-07-14
94341	Prowler RED Assless Cockring Jock Strap Ye	archived	11.56	8.09	10.52	2026-07-10	2026-07-11
96363	b-Vibe P-Spot Vibrating Massager	archived	49.99	35.00	45.49	2026-05-11	2026-06-12
97922	Blush Intimate Ring Flexible Enhancement	archived	40.99	27.99	37.30	2026-05-08	2026-05-11
80337	Magic Wand Mini Rechargeable Personal Mass	archived	109.95	60.99	100.05	2026-05-06	2026-05-08
80519	Evolved Intimate Wearable Remote-Controlle	archived	159.98	99.00	145.58	2026-05-05	2026-05-06
53907	Magic Wand Rechargeable Intimate Massager	archived	208.95	99.00	190.14	2026-05-04	2026-05-05
98310	Dame Panty Vibrator Remote Control	archived	79.00	55.30	71.89	2026-05-01	2026-05-04
74252	XR Brands Vibrating Bullet Remote Control 	archived	35.01	24.51	31.86	2026-04-27	2026-05-01
21408	Sportsheets Restraint System Under-Bed Des	archived	73.99	63.99	67.33	2026-04-22	2026-04-27
84807	Forto Rechargeable Silicone Couples Ring w	archived	63.99	53.99	58.23	2026-04-21	2026-04-22
77292	Lovense Ferri Bluetooth Remote Intimate We	archived	119.00	119.00	108.29	2026-04-20	2026-04-21
77286	Lovense Lush 2 Bluetooth Remote Intimate E	archived	104.00	104.00	94.64	2026-04-20	2026-04-20
77295	Lovense Lush 3 Bluetooth Remote Intimate E	archived	124.00	124.00	112.84	2026-04-20	2026-04-20
77284	Lovense Nora Remote-Controlled Bluetooth R	archived	119.00	119.00	108.29	2026-04-18	2026-04-20
84949	Curve Novelties Silicone Wellness Balls 28	archived	49.92	24.99	45.43	2026-04-16	2026-04-18
85256	Tantus Intimate Toy Curved Medium-Firm Eme	archived	42.00	31.99	38.22	2026-04-14	2026-04-16
65373	VeDO Roq Rechargeable Intimate Ring Black	archived	49.99	33.99	45.49	2026-04-14	2026-04-14
80263	TheVibed Rosales Suction Vibrator Lavender	archived	50.00	34.99	45.50	2026-04-13	2026-04-14
82306	Lovense Hush 2 Bluetooth Remote Intimate P	archived	119.00	99.00	108.29	2026-04-12	2026-04-13
88067	B Swish Curved Massager Infinite Vibration	archived	41.84	31.00	38.07	2026-04-12	2026-04-12
77283	Lovense Max 2 App-Controlled Vibrating Int	archived	119.00	119.00	89.25	2026-04-12	2026-04-12
43572	Doc Johnson Oral Enhancement Gel Clear For	archived	10.64	10.64	7.98	2026-04-12	2026-04-12
74051	Wicked Hybrid Lubricant Long-Lasting Formu	archived	18.58	13.01	13.93	2026-04-12	2026-04-12
82465	Tantus POP Slim Pleasure Toy Indiglow	archived	119.00	83.30	89.25	2026-04-12	2026-04-12
96183	Blush Performance Ring Accelerate Black	archived	39.99	39.99	29.99	2026-04-12	2026-04-12
84013	Lovense Wearable Vibrator Flexible Design	archived	119.00	119.00	89.25	2026-04-12	2026-04-12
97523	Evolved Intimate Massager Mint Infused	archived	139.98	139.98	104.98	2026-04-12	2026-04-12
80864	Aneros Helix Vibrating Prostate Massager	archived	100.00	99.95	75.00	2026-04-10	2026-04-12
97957	Prowler RED Intimate Beads Silicone Design	archived	28.00	19.60	21.00	2026-04-10	2026-04-10
95901	Lovense Mini Vibrator Compact Design	archived	139.00	139.00	104.25	2026-04-10	2026-04-10
35948	Sliquid Intimate Lubricant Water-Based 8.5	archived	22.00	17.60	16.50	2026-04-10	2026-04-10
93806	Lovense Lush 4 Bluetooth Remote Intimate E	archived	139.00	139.00	104.25	2026-04-10	2026-04-10
77544	TheVibed Rosales Suction Vibrator Intimate	archived	50.00	38.50	37.50	2026-04-08	2026-04-10
80926	Lovely Planet Silicone Plug Open Rose Desi	archived	22.99	22.99	17.24	2026-04-08	2026-04-08
77833	Tantus Curve Intimate Toy G-Spot Amethyst	archived	63.99	44.80	47.99	2026-04-08	2026-04-08
77776	Tantus Harness Kit Beginner-Friendly Laven	pending	93.99	65.80	-	2026-04-07	-
98267	Tantus Harness Kit Intermediate Lavender	pending	106.00	74.20	-	2026-04-07	-
97959	Prowler RED Silicone Intimate Beads Large 	pending	58.00	40.60	-	2026-04-04	-
83038	NS Novelties Intimate Massager Hurricane T	pending	120.00	84.00	-	2026-04-04	-
78413	Tantus Harness Premium Comfort Design	pending	105.00	73.50	-	2026-04-04	-
88040	Blush Intimate Massager Opal Design	pending	82.99	66.39	-	2026-04-04	-
88377	Fifty Shades Couples Kit Wireless Remote C	pending	99.00	73.50	-	2026-04-04	-
86540	Bijoux Indiscrets Massage Drops Revitalizi	pending	28.00	19.60	-	2026-04-03	-
24796	Hott Products Edible Lingerie Sweet Treat	pending	13.00	9.10	-	2026-04-03	-
39998	Kheper Games Intimate Game Seductive Play	pending	27.00	18.90	-	2026-04-03	-
4551	Nasstoys Intimate Lubricant Desensitizing 	pending	18.20	12.74	-	2026-04-02	-
82470	Tantus Packer Realistic Cream Design	pending	99.96	69.97	-	2026-04-02	-
76189	Shots Intimate Toy Crystal Clear 8" Suctio	pending	33.95	23.73	-	2026-04-02	-
19440	System JO H2O Water-Based Intimate Lubrica	pending	48.99	29.44	-	2026-04-02	-
76185	Shots Intimate Toy Crystal Clear 7" with S	pending	25.95	18.13	-	2026-04-02	-
60853	FemmeFunn Rabbit Vibrator Dual Stimulation	pending	124.99	99.99	-	2026-04-02	-
67793	VeDO Bump Rechargeable Intimate Vibe Black	pending	54.99	49.99	-	2026-04-02	-
27536	Swiss Navy Silicone Intimate Lubricant 4oz	pending	35.99	27.99	-	2026-04-02	-
58939	FemmeFunn Bullet Massager Rechargeable Sil	pending	59.99	49.99	-	2026-04-02	-
53906	Magic Wand Original Personal Massager HV-2	pending	104.45	76.95	-	2026-04-02	-
69840	Magic Wand Plus Rechargeable Intimate Mass	pending	120.95	87.95	-	2026-04-02	-
```
