/**
 * Cantidades de Alba en los favoritos de la dieta modular para sus objetivos de 1.600 kcal (v1.12.1).
 * Sustituyen a las del documento solo en los ingredientes indicados, en estado de consumo (como en dietaModular.ts).
 * Las de Dani no cambian. Los favoritos que no aparecen ya estaban en rango.
 */
export const ALBA_1600: Record<string, Record<string, number>> = {
  dm_A2: { proteina_vegetal: 30, avena: 25 },
  dm_A6: { proteina_chocolate: 25, avena: 15, platano: 90 },
  dm_A9: { avena: 30, proteina_whey: 10, chocolate_85: 10 },
  dm_B1: { pollo_pechuga: 120, arroz: 140, gazpacho: 180 },
  dm_B2: { pollo_pechuga: 115, papa_fresca: 195, gazpacho: 170 },
  dm_B3: { albondigas: 120, papa_fresca: 170 },
  dm_B4: { carne_picada: 95, pasta: 120, mozzarella_rallada: 15 },
  dm_B5: { contramuslo: 85, cuscus: 110, gazpacho: 180 },
  dm_B6: { chili: 200, arroz: 130, cottage: 85 },
  dm_B7: { pollo_pechuga: 95, tortilla_maiz: 3 },
  dm_B8: { carne_picada: 95, arroz: 130 },
  dm_B9: { pollo_pechuga: 110, gnocchi: 130, cottage: 35 },
  dm_B10: { carrilladas: 185, arroz: 130 },
  dm_B11: { pollo_pechuga: 125, garbanzos: 100, cottage: 25 },
  dm_B12: { carrilladas: 185, papa_fresca: 165, cottage: 45, gazpacho: 160 },
  dm_B13: { carne_picada: 90, gnocchi: 145, mozzarella_rallada: 15 },
  dm_B14: { pollo_pechuga: 100, cuscus: 95, garbanzos: 70, cottage: 60 },
  dm_C2: { carne_picada: 110, papa_fresca: 185, havarti_light: 20 },
  dm_C3: { pollo_pechuga: 115, tortilla_maiz: 3, mozzarella_rallada: 25, gazpacho: 160 },
  dm_C4: { atun: 85, huevo: 2 },
  dm_C5: { albondigas: 115, papa_fresca: 165 },
  dm_C6: { pollo_pechuga: 105, cuscus: 115, cottage: 80, gazpacho: 180 },
  dm_C8: { carne_picada: 90, pasta: 110, mozzarella_rallada: 15, cottage: 70 },
  dm_C9: { garbanzos: 95, atun: 85, huevo: 2 },
  dm_C10: { pollo_pechuga: 105, gnocchi: 150, mozzarella_rallada: 20, cottage: 70 },
  dm_C11: { harina_avena: 35, huevo: 2 },
  dm_C12: { carrilladas: 195, cuscus: 115, cottage: 75 },
  dm_C14: { carrilladas: 185, gnocchi: 140, cottage: 60 },
};
