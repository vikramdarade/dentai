import { describe, it, expect } from 'vitest';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';
import { detectMacroFromContext, generateMacroNote } from '../src/lib/macroEngine';
import { ROUTINE_RESTORATION_MACRO, SURGICAL_EXTRACTION_MACRO, EMERGENCY_PULP_EXTIRPATION_MACRO } from '../src/lib/australianClinicalMacros';

describe('Australian Dental Clinical Entity Parser', () => {
  it('extracts FDI tooth and surface pairs accurately', () => {
    const transcript = 'We are doing a restorative filling today on tooth 16 MO. The cavity is deep into dentine.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.teeth).toContain('16');
    expect(vars.toothSurfacePairs).toEqual([{ tooth: '16', surface: 'MO' }]);
  });

  it('extracts local anaesthetic details (agent, spoken quantity, technique) without deriving volumes', () => {
    const transcript = 'Administering one cartridge of 4% articaine with 1:100,000 adrenaline via buccal infiltration. Adequate numbness confirmed.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.anaesthetic).toBeDefined();
    expect(vars.anaesthetic?.agent).toBe('4% Articaine');
    expect(vars.anaesthetic?.technique).toBe('infiltration');
    // Phase 10 (F-5): a spoken cartridge COUNT is preserved as spoken — the
    // parser must NOT convert it into a derived 2.2 mL figure that reads as
    // though the clinician spoke a volume.
    expect(vars.anaesthetic?.cartridges).toBe(1);
    expect(vars.anaesthetic?.volumeMl).toBeUndefined();
  });

  it('extracts an explicitly spoken millilitre volume as-is', () => {
    const transcript = 'Administered 2.2 mL of 4% articaine infiltration.';
    const vars = parseClinicalEntities(transcript);
    expect(vars.anaesthetic?.volumeMl).toBe(2.2);
    expect(vars.anaesthetic?.cartridges).toBeUndefined();
  });

  it('detects materials like composite shades, liners, and sutures', () => {
    const transcript = 'Applied Dycal and Vitreobond liner over deepest areas. Placing shade A3 composite incrementally. Sutured with 3-0 Prolene.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.materials?.compositeShade).toBe('A3');
    expect(vars.materials?.liner).toContain('Dycal');
    expect(vars.materials?.liner).toContain('Vitreobond');
    // Phase 10 sweep: the parser records the spoken BRAND only — gauge,
    // absorbability and "placed" are not asserted on the clinician's behalf.
    expect(vars.materials?.sutureType).toBe('Prolene');
  });

  it('detects verbal consent and aftercare instructions', () => {
    const transcript = 'Discussed all risks and alternatives, patient agreed and gave verbal consent. Post-op instructions given: soft diet and warm salt water.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.consentObtained).toBe(true);
    expect(vars.poigDiscussed).toBe(true);
  });
});

describe('Deterministic Macro Detection & Generation', () => {
  it('detects Routine Restoration and fills clinical slots deterministically', () => {
    const transcript = [
      { sender: 'Dentist', text: 'Good morning, today we are restoring tooth 36 MO with composite.' },
      { sender: 'Dentist', text: 'Discussed risks of pulpal involvement and sensitivity, patient gave verbal consent.' },
      { sender: 'Dentist', text: 'Giving one cartridge of 4% articaine buccal infiltration.' },
      { sender: 'Dentist', text: 'Caries removed, etch and bond applied, shade A3 composite cured.' },
      { sender: 'Dentist', text: 'Occlusion checked. Here are your post-op instructions: avoid hot food until numbness wears off.' },
    ];

    const macro = detectMacroFromContext(transcript);
    expect(macro.id).toBe(ROUTINE_RESTORATION_MACRO.id);

    const note = generateMacroNote(transcript);
    expect(note.title).toBe('Routine Restoration');
    expect(note.treatmentPerformed).toContain('Site: #36 (MO)');
    expect(note.treatmentPerformed).toContain('4% Articaine');
    expect(note.treatmentPerformed).toContain('shade A3');
    expect(note.treatmentPerformed).toContain('Occlusion checked');
    // Codes: only SPOKEN item numbers render — this transcript names none.
    expect(note.adaCodes.length).toBe(0);
    // Consent + aftercare were spoken (no notices for those), but no
    // diagnosis was SPOKEN — the template must flag it, not fabricate one.
    expect(note.missingProtocolNotices.join(' ')).toMatch(/no diagnosis/i);
    expect(note.missingProtocolNotices.join(' ')).not.toMatch(/consent was not heard/i);
  });

  it('flags receptionist-friendly notice when consent or aftercare is missing', () => {
    const transcript = 'Drilled and placed a filling on 16.';
    const note = generateMacroNote(transcript);

    expect(note.missingProtocolNotices).toContain('Notice: Verbal consent was not heard aloud on the recording');
    expect(note.missingProtocolNotices).toContain('Notice: Aftercare instructions were not heard aloud on the recording');
  });

  it('detects Surgical Extraction when bone guttering and flap are mentioned', () => {
    const transcript = 'Surgical extraction of tooth 38. Mucoperiosteal flap raised, bone gutter created under saline, tooth sectioned, Gelatemp placed and 3-0 Prolene suture.';
    const macro = detectMacroFromContext(transcript);
    expect(macro.id).toBe(SURGICAL_EXTRACTION_MACRO.id);

    const note = generateMacroNote(transcript);
    expect(note.title).toBe('Surgical Extraction');
    expect(note.treatmentPerformed).toContain('Site: #38');
    expect(note.treatmentPerformed).toContain('Prolene');
    expect(note.treatmentPerformed).toContain('Gelatemp');
    // Codes: only SPOKEN item numbers render — none named here.
    expect(note.adaCodes.length).toBe(0);
  });

  it('detects Emergency Pulp Extirpation when Odontopaste and canals are mentioned', () => {
    const transcript = 'Emergency root canal extirpation on tooth 16. Located 3 canals, extirpated pulp, placed Odontopaste dressing and Cavit.';
    const macro = detectMacroFromContext(transcript);
    expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);

    const note = generateMacroNote(transcript);
    expect(note.title).toBe('Emergency Pulp Extirpation');
    expect(note.treatmentPerformed).toContain('Site: #16');
    expect(note.treatmentPerformed).toContain('Canals located: 3');
    expect(note.treatmentPerformed).toContain('Odontopaste');
    expect(note.adaCodes.length).toBe(0);
  });
});
