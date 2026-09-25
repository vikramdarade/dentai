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

  it('extracts local anaesthetic details (agent, volume, technique)', () => {
    const transcript = 'Administering one cartridge of 4% articaine with 1:100,000 adrenaline via buccal infiltration. Adequate numbness confirmed.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.anaesthetic).toBeDefined();
    expect(vars.anaesthetic?.agent).toBe('4% Articaine');
    expect(vars.anaesthetic?.volumeMl).toBe(2.2);
    expect(vars.anaesthetic?.technique).toBe('infiltration');
  });

  it('detects materials like composite shades, liners, and sutures', () => {
    const transcript = 'Applied Dycal and Vitreobond liner over deepest areas. Placing shade A3 composite incrementally. Sutured with 3-0 Prolene.';
    const vars = parseClinicalEntities(transcript);

    expect(vars.materials?.compositeShade).toBe('A3');
    expect(vars.materials?.liner).toContain('Dycal');
    expect(vars.materials?.liner).toContain('Vitreobond');
    expect(vars.materials?.sutureType).toContain('3-0 Prolene');
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
    expect(note.treatmentPerformed).toContain('#36 (MO)');
    expect(note.treatmentPerformed).toContain('4% Articaine');
    expect(note.treatmentPerformed).toContain('A3 composite');
    expect(note.treatmentPerformed).toContain('Occlusion checked');
    expect(note.adaCodes.some(c => c.code === '532')).toBe(true);
    expect(note.missingProtocolNotices).toHaveLength(0);
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
    expect(note.treatmentPerformed).toContain('#38');
    expect(note.treatmentPerformed).toContain('Bone gutter created');
    expect(note.treatmentPerformed).toContain('3-0 Prolene');
    expect(note.adaCodes.some(c => c.code === '324')).toBe(true);
  });

  it('detects Emergency Pulp Extirpation when Odontopaste and canals are mentioned', () => {
    const transcript = 'Emergency root canal extirpation on tooth 16. Located 3 canals, extirpated pulp, placed Odontopaste dressing and Cavit.';
    const macro = detectMacroFromContext(transcript);
    expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);

    const note = generateMacroNote(transcript);
    expect(note.title).toBe('Emergency Pulp Extirpation');
    expect(note.treatmentPerformed).toContain('#16');
    expect(note.treatmentPerformed).toContain('3 canals located');
    expect(note.treatmentPerformed).toContain('Odontopaste');
    expect(note.adaCodes.some(c => c.code === '414')).toBe(true);
  });
});
