%[text] # Exploring Temperature Conversions
%[text] This live script explores **temperature conversions** between Celsius, Fahrenheit, and Kelvin using three key formulas:
%[text] - *Celsius to Fahrenheit*: `F = (C × 9/5) + 32`
%[text] - *Celsius to Kelvin*: `K = C + 273.15`
%[text] - *Fahrenheit to Celsius*: `C = (F − 32) × 5/9` \
%%
%[text] ## Boiling and Freezing Points
%[text] We start with two reference temperatures every student knows.
C_boil = 100;
F_boil = (C_boil * 9/5) + 32;
K_boil = C_boil + 273.15;
fprintf("Boiling point: %.2f°C = %.2f°F = %.2f K", C_boil, F_boil, K_boil); %[output:3a1c9d02]
C_freeze = 0;
F_freeze = (C_freeze * 9/5) + 32;
K_freeze = C_freeze + 273.15;
fprintf("Freezing point: %.2f°C = %.2f°F = %.2f K", C_freeze, F_freeze, K_freeze); %[output:7f84e6b1]
%%
%[text] ## Absolute Zero
%[text] **Absolute zero** is the lowest theoretically possible temperature — the point at which all classical thermal motion ceases.
%[text] It is defined as exactly $ 0 \\, \\text{K} $, equivalent to $ -273.15°\\text{C} $ and $ -459.67°\\text{F} $.
T_abs_K = 0;
T_abs_C = T_abs_K - 273.15;
T_abs_F = (T_abs_C * 9/5) + 32;
fprintf("Absolute zero: %.2f K = %.2f°C = %.2f°F", T_abs_K, T_abs_C, T_abs_F); %[output:c2d05f77]
%%
%[text] ## Reference Table
%[text] A summary of common temperatures across all three scales.
temps_C = [-273.15, -40, 0, 20, 37, 100];
temps_F = (temps_C * 9/5) + 32;
temps_K = temps_C + 273.15;
disp(table(temps_C', temps_F', temps_K', 'VariableNames', {'Celsius','Fahrenheit','Kelvin'})) %[output:b9a73e40]
%%
%[text] ## City Temperature Lookup
%[text] Use the dropdown to select a city and display its average annual temperature in all three scales.
city = "Toronto"; %[control:dropdown:e5c1a2f8]{"position":[7,15]}
cityTemps = containers.Map( ...
    {"Toronto","Cairo","Reykjavik","Singapore","Sydney"}, ...
    {9.4, 21.9, 5.0, 27.5, 17.7});
avg_C = cityTemps(city);
avg_F = (avg_C * 9/5) + 32;
avg_K = avg_C + 273.15;
fprintf("%s: %.1f°C | %.1f°F | %.2f K", city, avg_C, avg_F, avg_K); %[output:d1f830c9]
%[appendix]{"version":"1.0"}
%---
%[metadata:view]
%   data: {"layout":"inline"}
%---
%[output:3a1c9d02]
%   data: {"dataType":"text","outputData":{"text":"Boiling point: 100.00°C = 212.00°F = 373.15 K","truncated":false}}
%---
%[output:7f84e6b1]
%   data: {"dataType":"text","outputData":{"text":"Freezing point: 0.00°C = 32.00°F = 273.15 K","truncated":false}}
%---
%[output:c2d05f77]
%   data: {"dataType":"text","outputData":{"text":"Absolute zero: 0.00 K = -273.15°C = -459.67°F","truncated":false}}
%---
%[output:b9a73e40]
%   data: {"dataType":"text","outputData":{"text":"  Celsius    Fahrenheit    Kelvin\n  _______    __________    ______\n  -273.15      -459.67       0   \n   -40          -40        233.15\n     0           32        273.15\n    20           68        293.15\n    37          98.6       310.15\n   100          212        373.15","truncated":false}}
%---
%[control:dropdown:e5c1a2f8]
%   data: {"label":"city","options":["Toronto","Cairo","Reykjavik","Singapore","Sydney"],"value":"Toronto"}
%---
%[output:d1f830c9]
%   data: {"dataType":"text","outputData":{"text":"Toronto: 9.4°C | 48.9°F | 282.55 K","truncated":false}}
%---
