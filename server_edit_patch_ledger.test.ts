import { describe, it, expect } from 'vitest';
import {
  diffScoutToEditCommands,
  applyUserLockedSlots,
  mergeLocksFromCommands,
  invalidateStaleIdentityMetadata,
  buildEditExpertDispatch,
  reaggregateDishWeightFromComponents,
} from './server_edit_patch_ledger.js';

describe('edit patch ledger', () => {
  it('diffs identity + weight into structural commands', () => {
    const prior = [
      { scoutIndex: 0, name: 'Cakalang Suwir Petai', weightGrams: 200, nutrients: { protein: 40 } },
      { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 210, nutrients: { protein: 5 } },
      { scoutIndex: 2, name: 'Es Teh Manis', weightGrams: 350, nutrients: { calories: 56, sugar: 14 } },
    ];
    const scout = [
      { scoutIndex: 0, originalName: 'Nila Suwir Petai', estimatedWeightGrams: 200, nutrients: { protein: 38 } },
      { scoutIndex: 1, originalName: 'Tumis Kangkung', estimatedWeightGrams: 125 },
      { scoutIndex: 2, originalName: 'Es Teh Tawar', estimatedWeightGrams: 350, nutrients: { calories: 0, sugar: 0 } },
    ];
    const cmds = diffScoutToEditCommands({ priorItems: prior, scoutItems: scout });
    expect(cmds.some((c) => c.action === 'replace_identity' && c.newItemName === 'Nila Suwir Petai')).toBe(true);
    expect(cmds.some((c) => c.action === 'set_weight' && c.itemName === 'Tumis Kangkung' && c.newWeightGrams === 125)).toBe(true);
    expect(cmds.some((c) => c.action === 'replace_identity' && String(c.newItemName).includes('Tawar'))).toBe(true);
  });

  it('enforces identity locks against scout regression', () => {
    const locked = applyUserLockedSlots({
      scoutItems: [
        { scoutIndex: 0, originalName: 'Cakalang Suwir Petai', estimatedWeightGrams: 200 },
        { scoutIndex: 1, originalName: 'Tumis Kangkung', estimatedWeightGrams: 125 },
      ],
      locks: [{ scoutIndex: 0, field: 'identity', value: 'Nila Suwir Petai', lockedAtTurn: 2 }],
      userMessage: 'the kangkung is 100g',
    });
    expect(locked.items[0].originalName).toBe('Nila Suwir Petai');
    expect(locked.notes.some((n) => n.includes('lock identity'))).toBe(true);
  });

  it('invalidates stale manis sibling metadata on identity change', () => {
    const purged = invalidateStaleIdentityMetadata({
      name: 'Es Teh Manis',
      keyword: 'Es Teh Tawar',
      ingredientsList: ['Es Teh Manis'],
      visualIngredients: ['Es Teh Manis'],
      genericEnglishName: 'sweetened iced tea',
      preCalcNutrients: { calories: 56, sugar: 14 },
      nutrients: { calories: 0 },
    }, 'Es Teh Tawar');
    expect(purged.name).toBe('Es Teh Tawar');
    expect(purged.ingredientsList).toEqual(['Es Teh Tawar']);
    expect(purged.visualIngredients).toEqual(['Es Teh Tawar']);
    expect(purged.preCalcNutrients).toBeUndefined();
    expect(purged.genericEnglishName).toBeUndefined();
  });

  it('merges locks from applied commands', () => {
    const locks = mergeLocksFromCommands({
      priorLocks: [],
      commands: [
        { action: 'replace_identity', itemName: 'Cakalang Suwir Petai', newItemName: 'Nila Suwir Petai', scoutIndex: 0 },
        { action: 'set_weight', itemName: 'Tumis Kangkung', newWeightGrams: 125, scoutIndex: 1 },
      ],
      itemsAfter: [
        { scoutIndex: 0, name: 'Nila Suwir Petai', weightGrams: 200 },
        { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 125 },
      ],
      turn: 2,
      userMessage: 'the tea is tawar and the fish is nilai',
    });
    expect(locks.find((l) => l.field === 'identity' && l.scoutIndex === 0)?.value).toBe('Nila Suwir Petai');
    expect(locks.find((l) => l.field === 'weightGrams' && l.scoutIndex === 1)?.value).toBe(125);
  });

  it('builds expert dispatch with full I/O fields', () => {
    const d = buildEditExpertDispatch({
      turn: 2,
      userMessage: 'the tea is tawar',
      finalMessage: 'Updated tea to unsweetened.',
      editCommands: [{ action: 'set_modifier', itemName: 'Es Teh Manis', modifier: 'unsweetened' }],
      items: [{ scoutIndex: 2, name: 'Es Teh Tawar', weightGrams: 350, nutrients: { calories: 0 } }],
    });
    expect(d.id).toBe('t2/diet');
    expect(d.agent).toBe('diet');
    expect(d.systemInstruction).toBeTruthy();
    expect(d.systemInstruction).toContain('TARGETED DISH UPDATE ONLY');
    expect(d.userPrompt).toBeTruthy();
    expect(d.rawEmission).toBeTruthy();
    expect(d.output.skipped).toBe(false);
  });

  it('carries verdict alongside the advice message for contract parity', () => {
    const d = buildEditExpertDispatch({
      turn: 2,
      userMessage: 'oats 130g',
      finalMessage: 'You got quality protein from the meat soups and steady energy from the adjusted cereal portion in this meal.',
      editCommands: [{ action: 'update_weight', itemName: 'Energen Cereal', newWeightGrams: 130 }],
      items: [{ scoutIndex: 2, name: 'Energen Cereal', weightGrams: 130, nutrients: { calories: 557 } }],
      verdict: { label: 'Increased Carbohydrate and Calorie Load', level: 'warning' },
    });
    expect(d.output.verdict).toEqual({ label: 'Increased Carbohydrate and Calorie Load', level: 'warning' });
    expect(d.rawEmission.verdict.label).toBeTruthy();
    const bare = buildEditExpertDispatch({
      turn: 2,
      finalMessage: 'Updated.',
      editCommands: [],
      items: [],
    });
    expect(bare.output.verdict).toBeUndefined();
  });

  it('preserves prior identity locks when a later turn only sets weight', () => {
    const locks = mergeLocksFromCommands({
      priorLocks: [
        { scoutIndex: 0, field: 'identity', value: 'Ikan Nila Suwir Petai', lockedAtTurn: 2 },
        { scoutIndex: 2, field: 'identity', value: 'Es Teh Tawar', lockedAtTurn: 2 },
      ],
      commands: [
        { action: 'set_weight', itemName: 'Tumis Kangkung', newWeightGrams: 120, scoutIndex: 1 },
      ],
      itemsAfter: [
        { scoutIndex: 0, name: 'Ikan Nila Suwir Petai', weightGrams: 160 },
        { scoutIndex: 1, name: 'Tumis Kangkung', weightGrams: 120 },
        { scoutIndex: 2, name: 'Es Teh Tawar', weightGrams: 300 },
      ],
      turn: 3,
      userMessage: 'the kangkung is 100g',
    });
    expect(locks.find((l) => l.field === 'identity' && l.scoutIndex === 0)?.value).toBe('Ikan Nila Suwir Petai');
    expect(locks.find((l) => l.field === 'weightGrams' && l.scoutIndex === 1)?.value).toBe(120);
  });

  it('reaggregates parent weight from components', () => {
    const out = reaggregateDishWeightFromComponents({
      name: 'Tumis Kangkung',
      weightGrams: 210,
      nutrients: { calories: 123, protein: 5 },
      componentsDetailList: [
        { name: 'Kangkung', weightGrams: 100, nutrients: { calories: 20 } },
        { name: 'Oil', weightGrams: 25, nutrients: { calories: 50 } },
      ],
    });
    expect(out.weightGrams).toBe(125);
  });

  it('diffs portion update with empty scout emission via arrow syntax in userMessage', () => {
    const prior = [
      { scoutIndex: 0, name: 'Lemonilo Brownies Crispy', weightGrams: 15, nutrients: { calories: 70 } },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: [],
      userMessage: 'Please update my meal portions: Lemonilo Brownies Crispy: 15g ➔ 30g (+100%). Because the portion difference exceeds 30%, please review...',
    });
    expect(cmds.length).toBe(1);
    expect(cmds[0].action).toBe('set_weight');
    expect(cmds[0].itemName).toBe('Lemonilo Brownies Crispy');
    expect(cmds[0].newWeightGrams).toBe(30);
  });

  it('diffs portion update with empty scout emission via portionChoices', () => {
    const prior = [
      { scoutIndex: 0, name: 'Lemonilo Brownies Crispy', weightGrams: 15, nutrients: { calories: 70 } },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: [],
      portionChoices: { '0': 30 },
    });
    expect(cmds.length).toBe(1);
    expect(cmds[0].action).toBe('set_weight');
    expect(cmds[0].itemName).toBe('Lemonilo Brownies Crispy');
    expect(cmds[0].newWeightGrams).toBe(30);
  });

  it('aligns scout partial dish update to correct item in multi-dish meal without deleting others', () => {
    const prior = [
      { scoutIndex: 0, name: 'Beef and Vegetable Hotpot', weightGrams: 300, sourceImageIndex: 0 },
      { scoutIndex: 1, name: 'Sizzling Steak and Sausages', weightGrams: 200, sourceImageIndex: 1 },
    ];
    const scout = [
      {
        name: 'Sizzling Steak and Sausages with Vegetables',
        estimatedWeightGrams: 180,
        sourceImageIndex: 1,
        foods: [
          { foodName: 'Beef Steak', weightGrams: 100 },
          { foodName: 'Mixed Vegetables', weightGrams: 80 },
        ],
      },
    ];
    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: scout,
      userMessage: 'The beef steak is 100g and there was vegetable as well in this plate',
    });
    // Beef Hotpot must NOT be replaced!
    expect(cmds.some(c => c.itemName === 'Beef and Vegetable Hotpot' && c.action === 'replace_identity')).toBe(false);
    // Steak item must be targeted
    expect(cmds.some(c => c.itemName === 'Sizzling Steak and Sausages')).toBe(true);
  });

  it('correctly substitutes sweet tea for unsweetened tea and updates fish identity without duplication', async () => {
    const prior = [
      { name: 'Nasi Putih', weightGrams: 150, sourceImageIndex: 0, nutrients: { calories: 195, sodium: 5 } },
      { name: 'Cah Kangkung', weightGrams: 120, sourceImageIndex: 0, nutrients: { calories: 93, sodium: 550 } },
      {
        name: 'Ikan Bakar',
        weightGrams: 200,
        sourceImageIndex: 0,
        nutrients: { calories: 240, protein: 35, sodium: 550 },
        foods: [
          { foodName: 'Ikan Bakar', weightGrams: 180, nutrients: { protein: 35, sodium: 545 } },
          { foodName: 'Lalapan', weightGrams: 20, nutrients: { sodium: 5 } },
        ],
      },
      {
        name: 'Es Teh Manis',
        genericEnglishName: 'sweet iced tea',
        weightGrams: 300,
        sourceImageIndex: 0,
        nutrients: { calories: 90, addedSugar: 20, sodium: 10 },
        foods: [
          { foodName: 'Teh Manis', weightGrams: 300, nutrients: { addedSugar: 20, sodium: 10 } },
        ],
      },
      { name: 'Kue Apem Panggang', weightGrams: 60, sourceImageIndex: 1, nutrients: { calories: 138, addedSugar: 8, sodium: 120 } },
    ];

    const scout = [
      {
        name: 'Ikan Nila Bakar',
        genericEnglishName: 'grilled tilapia',
        estimatedWeightGrams: 200,
        sourceImageIndex: 0,
        nutrients: { calories: 210, protein: 38, sodium: 300 },
        foods: [
          { foodName: 'Ikan Nila Bakar', weightGrams: 200, nutrients: { calories: 210, protein: 38, sodium: 300 } },
        ],
      },
      {
        name: 'Es Teh Tawar',
        genericEnglishName: 'unsweetened iced tea',
        estimatedWeightGrams: 300,
        sourceImageIndex: 0,
        nutrients: { calories: 2, addedSugar: 0, sodium: 5 },
        foods: [
          { foodName: 'Teh Tawar', weightGrams: 300, nutrients: { calories: 2, addedSugar: 0, sodium: 5 } },
        ],
      },
    ];

    const cmds = diffScoutToEditCommands({
      priorItems: prior,
      scoutItems: scout,
      userMessage: 'The ikan is nilai and tea is unsweatened',
    });

    // Both should be replace_identity, NOT add_item
    expect(cmds.some(c => c.action === 'add_item')).toBe(false);
    expect(cmds.filter(c => c.action === 'replace_identity').length).toBe(2);

    const fishCmd = cmds.find(c => c.itemName === 'Ikan Bakar' && c.action === 'replace_identity');
    expect(fishCmd).toBeDefined();
    expect(fishCmd?.newItemName).toBe('Ikan Nila Bakar');

    const teaCmd = cmds.find(c => c.itemName === 'Es Teh Manis' && c.action === 'replace_identity');
    expect(teaCmd).toBeDefined();
    expect(teaCmd?.newItemName).toBe('Es Teh Tawar');
  });

  describe('Agent Explicit Edit Contract (replacesDish, targetDishIndex, action)', () => {
    const prior = [
      { name: 'Nasi Putih', weightGrams: 150, nutrients: { calories: 195 } },
      { name: 'Cah Kangkung', weightGrams: 120, nutrients: { calories: 93 } },
      { name: 'Ikan Bakar', weightGrams: 200, nutrients: { calories: 240 } },
      { name: 'Es Teh Manis', weightGrams: 300, nutrients: { calories: 90 } },
      { name: 'Kue Apem Panggang', weightGrams: 60, nutrients: { calories: 138 } },
    ];

    it('contract: honors explicit replacesDish property from agent scout emission', () => {
      const scout = [
        {
          name: 'Es Teh Tawar',
          action: 'replace',
          replacesDish: 'Es Teh Manis',
          estimatedWeightGrams: 300,
          nutrients: { calories: 2, addedSugar: 0 },
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('replace_identity');
      expect(cmds[0].itemName).toBe('Es Teh Manis');
      expect(cmds[0].newItemName).toBe('Es Teh Tawar');
    });

    it('contract: honors explicit targetDishIndex (1-based from prompt) from agent scout emission', () => {
      const scout = [
        {
          name: 'Ikan Nila Bakar',
          action: 'replace',
          targetDishIndex: 3, // Dish 3 from Prior Meal Dishes prompt: Ikan Bakar
          estimatedWeightGrams: 200,
          nutrients: { calories: 210, protein: 38 },
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('replace_identity');
      expect(cmds[0].itemName).toBe('Ikan Bakar');
      expect(cmds[0].newItemName).toBe('Ikan Nila Bakar');
    });

    it('contract: honors explicit action="add" and does NOT substitute existing items even if names share keywords', () => {
      const scout = [
        {
          name: 'Es Teh Hijau',
          action: 'add',
          estimatedWeightGrams: 250,
          nutrients: { calories: 10 },
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
        userMessage: 'Also add green tea',
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('add_item');
      expect(cmds[0].itemName).toBe('Es Teh Hijau');
    });

    it('contract: honors explicit action="delete" to remove a main dish by targetDishIndex or replacesDish', () => {
      const scout = [
        {
          name: 'Es Teh Manis',
          action: 'delete',
          targetDishIndex: 4,
          estimatedWeightGrams: 0,
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('remove_item');
      expect(cmds[0].itemName).toBe('Es Teh Manis');
    });

    it('contract: preserves sourceImageIndex and full nutrients when replacing a dish', () => {
      const scout = [
        {
          name: 'Ikan Nila Bakar',
          action: 'replace',
          replacesDish: 'Ikan Bakar',
          sourceImageIndex: 2,
          estimatedWeightGrams: 220,
          dishNutrients: { protein: 42, carbohydrates: 0, totalFat: 7, sodium: 350 },
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('replace_identity');
      expect(cmds[0].itemName).toBe('Ikan Bakar');
      expect(cmds[0].newItemName).toBe('Ikan Nila Bakar');
      expect(cmds[0].sourceImageIndex).toBe(2);
      expect(cmds[0].estimate?.protein).toBe(42);
      expect(cmds[0].estimate?.sodium).toBe(350);
    });

    it('contract: honors subitem actions (replace, add, delete) within a dish', () => {
      const priorWithComps = [
        {
          name: 'Ikan Bakar Platter',
          weightGrams: 250,
          sourceImageIndex: 0,
          components: [
            { name: 'Ikan Bakar', weightGrams: 200, nutrients: { protein: 35, sodium: 400 } },
            { name: 'Lalapan', weightGrams: 50, nutrients: { protein: 1, sodium: 5 } },
          ],
        },
      ];

      const scout = [
        {
          name: 'Ikan Bakar Platter',
          sourceImageIndex: 0,
          foods: [
            {
              foodName: 'Lalapan',
              action: 'delete',
              replacesFood: 'Lalapan',
            },
            {
              foodName: 'Sambal Terasi',
              action: 'add',
              weightGrams: 30,
              sourceImageIndex: 0,
              nutrients: { protein: 1, sodium: 200, carbohydrates: 3, totalFat: 2 },
            },
          ],
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: priorWithComps,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(2);
      const removeCmd = cmds.find(c => c.action === 'remove_component');
      expect(removeCmd).toBeDefined();
      expect(removeCmd?.componentName).toBe('Lalapan');

      const addCmd = cmds.find(c => c.action === 'add_component');
      expect(addCmd).toBeDefined();
      expect(addCmd?.componentName).toBe('Sambal Terasi');
      expect(addCmd?.newWeightGrams).toBe(30);
      expect(addCmd?.sourceImageIndex).toBe(0);
      expect(addCmd?.estimate?.nutrients?.sodium).toBe(200);
    });

    it('contract: when scout marks dish action="replace" but provides foods with action="add", dispatches subitem action rather than wiping components', () => {
      const priorHotpot = [
        {
          name: 'Beef and Vegetable Hotpot',
          weightGrams: 500,
          components: [
            { name: 'Beef Slices', weightGrams: 120, nutrients: { protein: 22, saturatedFat: 3.5 } },
            { name: 'Tofu', weightGrams: 100, nutrients: { protein: 8 } },
            { name: 'Shirataki Noodles', weightGrams: 100, nutrients: { carbohydrates: 3 } },
            { name: 'Napa Cabbage and Vegetables', weightGrams: 180, nutrients: { carbohydrates: 6 } },
          ],
        },
      ];

      const scout = [
        {
          dishName: 'Beef and Vegetable Hotpot',
          action: 'replace',
          replacesDish: 'Beef and Vegetable Hotpot',
          targetDishIndex: 0,
          estimatedWeightGrams: 550,
          foods: [
            {
              foodName: 'Potato',
              action: 'add',
              weightGrams: 50,
              nutrients: { protein: 1, carbohydrates: 11.8, sodium: 3 },
            },
          ],
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: priorHotpot,
        scoutItems: scout,
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('add_component');
      expect(cmds[0].itemName).toBe('Beef and Vegetable Hotpot');
      expect(cmds[0].componentName).toBe('Potato');
      expect(cmds[0].newWeightGrams).toBe(50);
    });

    it('contract: removes redundant package item when user clarifies same meal and targets correct dish by replacesDish', () => {
      const prior = [
        {
          name: 'Quaker Whole Rolled Oats Package',
          weightGrams: 140,
          packGrams: 800,
          scoutIndex: 0,
          rawNutritionLabel: { servingSize: '40g', calories: '160' },
        },
        {
          name: 'Cooked Oatmeal',
          weightGrams: 40,
          scoutIndex: 1,
        },
      ];
      const scout = [
        {
          dishName: 'Cooked Oatmeal',
          estimatedWeightGrams: 140,
          replacesDish: 'Cooked Oatmeal',
          targetDishIndex: 1,
          scoutIndex: 1,
          action: 'replace',
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: scout,
        userMessage: "The cooked oatmeal is the same as the package. It's all the same meal",
      });

      // 1. Should target Cooked Oatmeal for update (140g), NOT Quaker package
      expect(cmds.some(c => (c.action === 'set_weight' || c.action === 'replace_identity') && c.itemName === 'Cooked Oatmeal' && c.newWeightGrams === 140)).toBe(true);
      // 2. Should remove Quaker package because user clarified it is the same meal
      expect(cmds.some(c => c.action === 'remove_item' && c.itemName === 'Quaker Whole Rolled Oats Package')).toBe(true);
      // 3. Quaker package must NOT have been targeted as Cooked Oatmeal
      expect(cmds.some(c => c.action === 'replace_identity' && c.itemName === 'Quaker Whole Rolled Oats Package')).toBe(false);
    });

    it('emits merge_dishes preserving label truth and user selected weight when user says only had 1 dish', () => {
      const prior = [
        {
          name: 'Quaker Whole Rolled Oats',
          weightGrams: 100,
          packGrams: 800,
          scoutIndex: 0,
          rawNutritionLabel: { servingSize: '40g', calories: 160, protein: 5, saturatedFat: 1.5, carbohydrates: 27 },
        },
        {
          name: 'Rolled Oats Porridge',
          weightGrams: 250,
          scoutIndex: 1,
        },
      ];

      const cmds = diffScoutToEditCommands({
        priorItems: prior,
        scoutItems: [],
        userMessage: "I only had 1 dish. It's the same dish",
      });

      expect(cmds).toHaveLength(1);
      expect(cmds[0].action).toBe('merge_dishes');
      expect(cmds[0].itemName).toBe('Quaker Whole Rolled Oats');
      expect(cmds[0].targetItemName).toBe('Rolled Oats Porridge');
      // Must preserve the user-selected 100g portion, not add up 100g + 250g = 350g
      expect(cmds[0].newWeightGrams).toBe(100);
    });
  });
});
