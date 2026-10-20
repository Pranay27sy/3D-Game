'use strict';

// Mumbai and the Western Railway corridor to Dahanu Road, squeezed to 1:25.
//
// The map is a grid of 72 m cells, north at the top (small z). Each cell is a
// kind of land (or sea). Row 69 is Churchgate, row 0 is Dahanu Road; the
// railway runs straight up road column 3. Distances along the line are real
// railway kilometres (approximate) divided by 25, so stations and creeks sit
// in the right order and roughly the right place.
//
// Cell kinds:
//   water       sea, creek or lake
//   city        dense towers            mid    mid-rise shops and offices
//   res         housing societies        dense  Dharavi-style lanes of huts
//   industrial  docks, MIDC              town   small-town bazaar
//   park        lawns, maidans           gateway Gateway of India promenade
//   airport     runway and terminal      beach  sand you can drive on
//   farm        fields you can drive on  stunts salt-pan stunt yard
//   parking     open car park            forest national park (no cars)
//   wild        hills beyond the towns (no cars)
const MUMBAI = (() => {
  const NX = 8, NZ = 72;
  const KM = 40;                 // metres of game world per real railway kilometre (1:25)
  const Z_CHURCHGATE = 5020;
  const zOfKm = (km) => Z_CHURCHGATE - km * KM;

  const T = [];
  for (let j = 0; j < NZ; j++) T.push(new Array(NX).fill('water'));
  const fill = (j0, j1, i0, i1, kind) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (i >= 0 && i < NX && j >= 0 && j < NZ) T[j][i] = kind;
  };

  // North of Boisar: hills and fields with only the railway through them.
  fill(1, 10, 1, 7, 'wild');
  fill(0, 0, 4, 7, 'wild');
  fill(0, 0, 1, 1, 'beach');           // Dahanu beach
  fill(0, 0, 2, 2, 'farm');
  fill(0, 0, 3, 3, 'town');            // Dahanu Road
  // Boisar and Tarapur MIDC.
  fill(11, 12, 1, 1, 'farm');
  fill(11, 12, 2, 3, 'town');
  fill(11, 12, 4, 4, 'industrial');
  fill(11, 12, 5, 7, 'wild');
  // Countryside: Umroli, Palghar, Kelve Road, Saphale.
  fill(13, 34, 1, 3, 'farm');
  fill(13, 34, 4, 7, 'wild');
  fill(17, 18, 2, 4, 'town');          // Palghar
  fill(22, 22, 2, 3, 'town');          // Kelve Road
  fill(27, 27, 2, 3, 'town');          // Saphale
  fill(33, 33, 0, 5, 'water');         // Vaitarna river
  // Virar, Nalasopara, Vasai.
  fill(35, 36, 1, 4, 'res');
  fill(35, 36, 2, 3, 'mid');
  fill(35, 42, 5, 7, 'wild');
  fill(37, 42, 1, 1, 'res');
  fill(37, 42, 2, 3, 'mid');
  fill(37, 42, 4, 4, 'res');
  fill(39, 40, 5, 5, 'industrial');
  fill(43, 44, 0, 7, 'water');         // Vasai creek
  // Bhayandar, Mira Road, Dahisar.
  fill(45, 49, 2, 3, 'mid');
  fill(45, 49, 1, 1, 'res');
  fill(45, 49, 4, 4, 'res');
  fill(46, 46, 4, 4, 'stunts');        // the salt pans
  fill(45, 54, 5, 7, 'forest');        // Sanjay Gandhi National Park
  // Borivali, Kandivali, Malad, Goregaon.
  fill(50, 56, 1, 1, 'res');
  fill(50, 56, 2, 3, 'mid');
  fill(50, 56, 4, 4, 'res');
  fill(55, 56, 5, 5, 'res');
  fill(55, 56, 6, 7, 'forest');        // Aarey
  // Andheri.
  fill(57, 57, 1, 1, 'res');           // Versova
  fill(57, 57, 2, 3, 'city');
  fill(57, 57, 4, 4, 'industrial');    // MIDC
  fill(57, 57, 5, 5, 'res');           // Powai
  fill(57, 57, 6, 6, 'water');         // Powai lake
  fill(57, 57, 7, 7, 'forest');
  // Vile Parle, Santacruz, Khar, and the airport.
  fill(58, 60, 1, 1, 'res');
  fill(58, 59, 1, 1, 'beach');         // Juhu beach
  fill(58, 60, 2, 3, 'mid');
  fill(58, 59, 4, 5, 'airport');
  fill(60, 60, 4, 5, 'mid');           // Kalina
  fill(58, 61, 6, 7, 'res');           // Kurla, Ghatkopar
  // Bandra and BKC.
  fill(61, 61, 1, 1, 'res');
  fill(61, 61, 2, 3, 'city');
  fill(61, 61, 4, 4, 'city');          // BKC
  fill(61, 61, 5, 5, 'parking');
  // Mahim creek, Mahim, Dharavi, Sion.
  fill(62, 62, 3, 3, 'res');
  fill(62, 62, 4, 5, 'dense');         // Dharavi
  fill(62, 62, 6, 6, 'res');
  // Dadar, Matunga, Wadala.
  fill(63, 63, 2, 2, 'park');          // Shivaji Park
  fill(63, 63, 3, 3, 'city');
  fill(63, 63, 4, 4, 'mid');
  fill(63, 63, 5, 5, 'res');
  // Worli, Prabhadevi, Parel, Sewri.
  fill(64, 64, 1, 2, 'city');
  fill(64, 64, 3, 3, 'mid');
  fill(64, 64, 4, 4, 'res');
  fill(64, 64, 5, 5, 'industrial');
  // Mahalaxmi, Lower Parel, Byculla.
  fill(65, 65, 2, 2, 'park');          // the racecourse
  fill(65, 65, 3, 3, 'city');
  fill(65, 65, 4, 4, 'res');
  fill(65, 66, 5, 5, 'industrial');    // docks
  // Malabar Hill, Grant Road, Mumbai Central.
  fill(66, 67, 1, 1, 'res');
  fill(66, 66, 2, 3, 'city');
  fill(66, 66, 4, 4, 'mid');
  fill(67, 67, 2, 2, 'mid');
  fill(67, 67, 3, 3, 'city');
  fill(67, 67, 4, 4, 'mid');
  // Marine Drive, Churchgate, Fort, Colaba.
  fill(68, 68, 2, 2, 'mid');
  fill(68, 68, 3, 4, 'city');
  fill(69, 69, 2, 2, 'city');          // Nariman Point
  fill(69, 69, 3, 3, 'park');          // Oval Maidan
  fill(69, 69, 4, 4, 'city');          // Fort
  fill(70, 70, 3, 3, 'res');           // Colaba
  fill(70, 70, 4, 4, 'gateway');
  fill(71, 71, 3, 3, 'res');           // Navy Nagar

  // Roads that cross water or open country, as [column, firstRow, lastRow]
  // of north-south segments (segment row j joins node rows j and j + 1).
  const extraRoads = [
    [1, 62, 63],    // Bandra-Worli Sea Link
    [3, 43, 44],    // Vasai creek bridge (beside the rail bridge)
    [4, 43, 44],    // Vasai creek highway bridge
    [3, 11, 34],    // the highway north through the countryside
  ];

  // Western Railway stations, by railway km from Churchgate (approximate).
  const stations = [
    ['Churchgate', 'चर्चगेट', 0],
    ['Mumbai Central', 'मुंबई सेंट्रल', 4.3],
    ['Dadar', 'दादर', 10.2],
    ['Bandra', 'वांद्रे', 15.0],
    ['Andheri', 'अंधेरी', 22.0],
    ['Goregaon', 'गोरेगाव', 26.3],
    ['Malad', 'मालाड', 30.0],
    ['Borivali', 'बोरिवली', 34.0],
    ['Mira Road', 'मीरा रोड', 40.0],
    ['Bhayandar', 'भाईंदर', 43.6],
    ['Vasai Road', 'वसई रोड', 51.7],
    ['Nalasopara', 'नालासोपारा', 55.6],
    ['Virar', 'विरार', 60.0],
    ['Saphale', 'सफाळे', 76.6],
    ['Kelve Road', 'केळवे रोड', 84.2],
    ['Palghar', 'पालघर', 91.6],
    ['Boisar', 'बोईसर', 102.2],
    ['Dahanu Road', 'डहाणू रोड', 124.0],
  ].map(([name, marathi, km]) => ({ name, marathi, km, z: zOfKm(km) }));

  // Area names, checked in order: [name, firstRow, lastRow, firstCol, lastCol].
  const areas = [
    ['Gateway of India', 70, 70, 4, 4], ['Colaba', 70, 71, 0, 7], ['Nariman Point', 69, 69, 0, 2],
    ['Fort', 69, 69, 4, 7], ['Churchgate', 69, 69, 0, 7], ['Marine Drive', 68, 68, 0, 2], ['Girgaon', 68, 68, 0, 7],
    ['Malabar Hill', 66, 67, 0, 1], ['Mumbai Central', 66, 67, 0, 7], ['Mahalaxmi', 65, 65, 0, 2], ['Lower Parel', 65, 65, 0, 7],
    ['Sea Link', 62, 63, 0, 1], ['Worli', 64, 64, 0, 2], ['Parel', 64, 64, 0, 7], ['Shivaji Park', 63, 63, 2, 2], ['Dadar', 63, 63, 0, 7],
    ['Dharavi', 62, 62, 4, 5], ['Mahim', 62, 62, 0, 7], ['BKC', 61, 61, 4, 5], ['Kurla', 58, 61, 6, 7], ['Bandra', 61, 61, 0, 7],
    ['Juhu', 58, 59, 0, 1], ['Airport', 58, 59, 4, 5], ['Santacruz', 60, 60, 0, 7], ['Vile Parle', 58, 59, 0, 7],
    ['Powai', 57, 57, 5, 6], ['Andheri', 57, 57, 0, 7], ['Aarey', 55, 56, 6, 7], ['Goregaon', 55, 56, 0, 7],
    ['National Park', 45, 54, 5, 7], ['Malad', 53, 54, 0, 7], ['Kandivali', 51, 52, 0, 7], ['Borivali', 50, 50, 0, 7],
    ['Dahisar', 48, 49, 0, 7], ['Mira Road', 47, 47, 0, 7], ['Bhayandar', 45, 46, 0, 7], ['Vasai Creek', 43, 44, 0, 7],
    ['Vasai', 40, 42, 0, 7], ['Nalasopara', 37, 39, 0, 7], ['Virar', 35, 36, 0, 7], ['Vaitarna', 33, 34, 0, 7],
    ['Saphale', 24, 32, 0, 7], ['Kelve', 20, 23, 0, 7], ['Palghar', 14, 19, 0, 7], ['Boisar', 11, 13, 0, 7],
    ['Vangaon', 1, 10, 0, 7], ['Dahanu', 0, 0, 0, 7],
  ];

  // Places on the map: [type, name, block column, block row, side (0 N, 1 E, 2 S, 3 W)].
  const landmarks = [
    ['police', 'Colaba Police Station', 3, 70, 0],
    ['police', 'Bandra Police Station', 2, 61, 2],
    ['police', 'Borivali Police Station', 2, 50, 3],
    ['police', 'Vasai Police Station', 3, 41, 1],
    ['police', 'Palghar Police Station', 3, 17, 0],
    ['hospital', 'KEM Hospital', 4, 64, 0],
    ['hospital', 'Cooper Hospital', 2, 59, 2],
    ['hospital', 'Bhagwati Hospital', 3, 51, 1],
    ['hospital', 'Palghar Rural Hospital', 2, 18, 3],
    ['spray', 'Dadar Spray & Repair', 4, 63, 2],
    ['spray', 'Andheri Spray & Repair', 2, 57, 0],
    ['spray', 'Borivali Spray & Repair', 4, 52, 3],
    ['spray', 'Virar Spray & Repair', 3, 36, 1],
    ['spray', 'Boisar Spray & Repair', 2, 12, 3],
  ];

  // Work: [type, name, column, row, direction] of a lane segment.
  const jobs = [
    ['taxi', 'Churchgate taxi stand', 3, 68, 1],
    ['taxi', 'Dadar taxi stand', 3, 63, 1],
    ['taxi', 'Andheri taxi stand', 2, 57, 1],
    ['taxi', 'Borivali taxi stand', 3, 50, 1],
    ['taxi', 'Virar taxi stand', 3, 35, 1],
    ['delivery', 'Sewri docks', 5, 64, 1],
    ['delivery', 'Andheri MIDC', 5, 57, 1],
    ['delivery', 'Vasai industrial estate', 5, 39, 1],
    ['race', 'Marine Drive sprint', 2, 66, 1],
    ['race', 'Sea Link run', 1, 64, 3],
    ['race', 'Highway 48 dash', 3, 30, 1],
  ];

  return { NX, NZ, T, extraRoads, stations, areas, landmarks, jobs, zOfKm, KM, railColumn: 3, home: { i: 2, j: 63 } };
})();
