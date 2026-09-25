import { describe, it, expect } from 'vitest';
import { detectMacroFromContext, generateMacroNote } from '../src/lib/macroEngine';
import { parseClinicalEntities } from '../src/lib/clinicalEntityParser';
import {
  EMERGENCY_PULP_EXTIRPATION_MACRO,
  SIMPLE_EXTRACTION_MACRO,
  SURGICAL_EXTRACTION_MACRO
} from '../src/lib/australianClinicalMacros';

// Live Consult Transcript from user test (Dr. Mohammed & Lisa Simpson)
const LIVE_CONSULT_TRANSCRIPT = [
  { sender: 'Dentist', text: 'Emergency walk-in encounter started for lisa simpson.' },
  { sender: 'Dialogue', text: 'Hi, my name is Mohammed and I will be your dentist today. How how are you doing today?' },
  { sender: 'Dialogue', text: "OK, I'm sorry to hear that. Is it because of that too that's giving you issues? It looks terrible. I can't sleep last night and it's like moving. I couldn't even be it's. Oh yes, yeah, I'm really sorry to hear that. I know how stressful is is to get pain and you couldn't sleep at night. Yeah. And I will try actually to do my best today in in order to solve your problem. I just will need first to confirm few points if you don't mind." },
  { sender: 'Dialogue', text: 'OK, sure. I just got from your medical history that you are taking actually a lot of medications.' },
  { sender: 'Dialogue', text: "I think you're taking some medications for the hypertension and some, yeah, some for heart disease. Yeah. And we are, we are actually in, in our dental field. Some of the medications can affect our treatment plan and it actually can." },
  { sender: 'Dialogue', text: "We, we can modify what we are going to do for the tools If, if, if we don't know actually what what you are taking exactly. So we have here warfarin you are taking." },
  { sender: 'Dialogue', text: 'I just want to ask about the if you remember doing any like any lab tests recently so you want for him if you remember.' },
  { sender: 'Dialogue', text: 'But it is time looks like. Is it really? I\'m not sure.' },
  { sender: 'Dialogue', text: 'Yeah, I think this one is for for the osteoporosis. Yeah, yeah.' },
  { sender: 'Dialogue', text: 'OK. And if you don\'t mind asking, do do you remember if this is the first injection to take or you you do?' },
  { sender: 'Dialogue', text: "Yeah, yeah, that's alright." },
  { sender: 'Dialogue', text: "OK, that's, that's alright. We can check with your GP to know exactly to know exactly more details about that. That's all right. What I will need to do is first I will need to know these medications, if it is safe to do a dental treatment while you are taking these medications or not, because the blood thinner that you are taking, it can actually affect the bleeding. You can bleed more than normal." },
  { sender: 'Dialogue', text: 'If if, if you are taking these medications.' },
  { sender: 'Dialogue', text: "Yeah, yeah, I understand your concern and we will try our best today to relieve the pain, but it's also important to." },
  { sender: 'Dialogue', text: 'Or any problems that might be I mean.' },
  { sender: 'Dialogue', text: "I understand OK, what what I will need to do, we need to go with you through the account and it's one of them actually is." },
  { sender: 'Dialogue', text: 'All the other options and see if we can do something else or not.' },
  { sender: 'Dialogue', text: 'Yeah, yeah, I understand your point.' },
  { sender: 'Dialogue', text: "It's it's actually the antibiotic, especially with the antibiotic, it can, it has for sure good effects, but it won't actually help much in your in in your situation, what's the best solution to do something for either putting business out or seeing the nerve from inside the tooth out, which will relieve the problem? So OK, before, before going through the the the treatment, I just would like to." },
  { sender: 'Dialogue', text: "Just briefly explain what's happening in the tooth, why it's like that. From the X-ray provided, I can see that there is actually a defling in the tooth and the nerve inside the tooth become inflamed and there is also some signs of infection around the roots in the X-ray. So all this actually is the cause of why it is my base wobbly now and why you are getting pain from it. OK, so the options of treatment here we can do we?" },
  { sender: 'Dialogue', text: 'Cold nerve from inside the tooth and usually this is a safe, umm, like a safe procedure that we can do it even without knowing what are the medications that you are taking because they won\'t affect much our treatment here. The other option is to take it out, but taking the tooth out will leave a gap for sure in the in in in this place and also will cause bleeding if you are taking a blood thinner. We must bleed actually more the the, the, the the.' },
  { sender: 'Dialogue', text: "You are taking the denosuma can affect the healing of the wound. If if the healing becomes delayed, it might get infected more and it will cause more serious problem. So we don't want to go for any serious issues in your mouth without consulting your GP first about that. So I'm not saying that we are not going to take the tooth. Even if you want to take the tooth out later, we can do it but after we consult your GP to make sure that this is doesn't have any consequences." },
  { sender: 'Dialogue', text: 'And to make sure that will be on the best interest of your health. So what I\'m suggesting if you accept that today to do.' },
  { sender: 'Dialogue', text: 'We call it emergency nerve removal. What we will do, we will numb the tooth 1st and we\'ll remove the nerve from inside the tooth and then we\'ll put a temporary filling (composite restoration) we need to reassess the condition again, the condition of the tooth later and the options are open for you later if you like to do to complete the procedure, the nerve treatment procedure, OK, or if you like to take the tooth out.' },
  { sender: 'Dialogue', text: 'Yeah, yeah, I understand your point. I, I, I, I can say that most of the pain will disappear. However, you might get some pain after after the procedure. We can control that with the medication. You already, I think you are taking already Benadryl. Umm, yeah. So maybe we\'ll try another thing, Umm, another type of painkiller.' },
  { sender: 'Dialogue', text: 'Antibiotic won\'t help much also here because the antibiotic can have more side effects on your general health more than the benefits here. The best treatment here is to do something on the tooth so.' },
  { sender: 'Dialogue', text: 'Yeah.' },
  { sender: 'Dialogue', text: 'I understand, I understand, I understand your point. But usually with with all the medications that you are taking, it\'s not safe actually to give you antibiotic. It might interact with any of the medication, it might cause further problems. So I, I, I would rather not to give you antibiotic at this stage. I if the infection progress more, if it become like a more extended big swelling which which is spreading to the.' },
  { sender: 'Dialogue', text: 'The structures in your face or in your mouth then we will consider antibiotic but the antibiotic now have limited actually benefit on your on your condition. The best thing that when we actually remove the nerve, we are opening a pathway for the infection to go outside the tooth. So this will help also the condition to subside quickly without the need of the antibiotic. And I will be I will be I mean available anytime if you if you find.' },
  { sender: 'Dialogue', text: 'Yeah, I understand. I mean if, if, if it is not our working time, you can go to the hospital. They will take care about you within our working days. You can contact us at at any time.' },
  { sender: 'Dialogue', text: 'Tomorrow I can give you my number as well. I\'m just in case if anything happened just I will be aware of it and I will guide you through what to do.' },
  { sender: 'Dialogue', text: "Yeah, yeah, sure, sure, Yeah, sure. We will try our best today. We'll we'll open the tooth, we'll remove the nerve, we'll put the dressing inside the tooth. We'll put a temporary filling. We'll prescribe for you a painkiller. And yeah, yeah. And we'll see tomorrow. Let us know if if, if it become worse, if it becoming better. Give us a call and." },
  { sender: 'Dialogue', text: 'To see you next next week to see if if there is any issues, if it becomes better, then you have the options either to either to be referred to a specialist to complete the procedure, the nerve treatment or we can take the tooth out or refer you also to a specialist to take the tooth out.' },
  { sender: 'Dialogue', text: 'Thank you.' }
];

describe('Live Consult Clinical Accuracy (Dr. Mohammed / Lisa Simpson)', () => {
  it('correctly routes emergency nerve extirpation and negates tooth extraction', () => {
    const macro = detectMacroFromContext(LIVE_CONSULT_TRANSCRIPT, 'emergency');
    expect(macro.id).toBe(EMERGENCY_PULP_EXTIRPATION_MACRO.id);
    expect(macro.id).not.toBe(SIMPLE_EXTRACTION_MACRO.id);
    expect(macro.id).not.toBe(SURGICAL_EXTRACTION_MACRO.id);
  });

  it('generates an extirpation note without any extraction ADA items or forceps narrative', () => {
    const note = generateMacroNote(LIVE_CONSULT_TRANSCRIPT, 'standard', 'emergency');
    
    // Procedure must be Emergency Pulp Extirpation
    expect(note.title).toBe('Emergency Pulp Extirpation');
    expect(note.treatmentPerformed).toContain('extirpated');
    expect(note.treatmentPerformed).not.toContain('forceps technique');
    expect(note.treatmentPerformed).not.toContain('Simple extraction');
    expect(note.treatmentPerformed).not.toContain('elevated and removed');

    // ADA codes must be 414 (Pulp Extirpation), never 311 (Extraction)
    expect(note.adaCodes.some(c => c.code === '414')).toBe(true);
    expect(note.adaCodes.some(c => c.code === '311')).toBe(false);
  });

  it('extracts critical pharmacology alerts (Warfarin bleeding risk & Denosumab MRONJ risk)', () => {
    const vars = parseClinicalEntities(LIVE_CONSULT_TRANSCRIPT);
    
    // Medical history must capture Warfarin and Denosumab
    expect(vars.history).toBeDefined();
    const historyLower = (vars.history || '').toLowerCase();
    expect(historyLower).toContain('warfarin');
    expect(historyLower).toContain('denosumab');
    expect(historyLower).toContain('bleeding risk');
    expect(historyLower).toContain('mronj risk');
    expect(historyLower).toContain('hypertension');
    expect(historyLower).toContain('heart disease');

    // Chief complaint must capture sleep disruption and wobbly tooth
    expect(vars.complaint).toBeDefined();
    const complaintLower = (vars.complaint || '').toLowerCase();
    expect(complaintLower).toMatch(/sleep|night/);
    expect(complaintLower).toMatch(/wobbly|mobile/);
  });

  it('macro note preserves high-risk medications and never synthesises false medical clearance', () => {
    const note = generateMacroNote(LIVE_CONSULT_TRANSCRIPT, 'standard', 'emergency');
    
    // Never synthesize "nil blood thinners" or "nil bisphosphonates"
    expect(note.history).not.toContain('nil blood thinners');
    expect(note.history).not.toContain('nil bisphosphonates');
    expect(note.history.toLowerCase()).toContain('warfarin');
    expect(note.history.toLowerCase()).toContain('denosumab');
  });
});
