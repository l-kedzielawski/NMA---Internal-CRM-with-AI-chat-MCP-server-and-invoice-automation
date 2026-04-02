import 'dotenv/config';
import { pool } from '../config/database';
import { ensureResourceSchema } from '../config/resourceSchema';
import type { ResultSetHeader } from 'mysql2';

/**
 * Seed sample resource templates with translations
 */
async function seedResources() {
  try {
    console.log('🌱 Seeding resource templates...');
    await ensureResourceSchema();

    const templates = [
      {
        title: 'Price too high - Budget constraints',
        category: 'price',
        content: `I completely understand budget considerations are crucial for any business decision. Let me show you how we can structure this to fit within your budget:

1. Volume-based pricing: Our tiered pricing model means larger orders result in significant per-unit savings. Many clients find that ordering in bulk actually reduces their overall cost per month.

2. Payment flexibility: We offer flexible payment terms - you can spread the cost over quarterly or monthly payments rather than a large upfront investment.

3. ROI perspective: Let's look at the value this brings. Our clients typically see [specific benefit/ROI] within [timeframe], which often offsets the initial investment within the first quarter.

4. Custom package: I'd be happy to work with you to create a customized package that fits your current budget while still delivering the core value you need.

Would you be open to exploring one of these options to find a solution that works for your budget?`,
        tags: ['budget', 'pricing', 'enterprise'],
        translations: [
          {
            language_code: 'de',
            title: 'Preis zu hoch - Budgetbeschränkungen',
            content: `Ich verstehe völlig, dass Budgetüberlegungen für jede Geschäftsentscheidung entscheidend sind. Lassen Sie mich Ihnen zeigen, wie wir dies so strukturieren können, dass es in Ihr Budget passt:

1. Mengenbasierte Preisgestaltung: Unser gestaffeltes Preismodell bedeutet, dass größere Bestellungen zu erheblichen Einsparungen pro Einheit führen. Viele Kunden stellen fest, dass Großbestellungen ihre Gesamtkosten pro Monat tatsächlich senken.

2. Zahlungsflexibilität: Wir bieten flexible Zahlungsbedingungen an - Sie können die Kosten auf vierteljährliche oder monatliche Zahlungen verteilen, anstatt eine große Vorauszahlung zu leisten.

3. ROI-Perspektive: Schauen wir uns den Wert an, den dies bringt. Unsere Kunden sehen in der Regel [spezifischer Nutzen/ROI] innerhalb von [Zeitrahmen], was die anfängliche Investition oft innerhalb des ersten Quartals ausgleicht.

4. Individuelles Paket: Ich arbeite gerne mit Ihnen zusammen, um ein maßgeschneidertes Paket zu erstellen, das zu Ihrem aktuellen Budget passt und dennoch den Kernwert liefert, den Sie benötigen.

Wären Sie offen dafür, eine dieser Optionen zu erkunden, um eine Lösung zu finden, die für Ihr Budget funktioniert?`
          },
          {
            language_code: 'fr',
            title: 'Prix trop élevé - Contraintes budgétaires',
            content: `Je comprends parfaitement que les considérations budgétaires sont cruciales pour toute décision commerciale. Permettez-moi de vous montrer comment nous pouvons structurer cela pour s'adapter à votre budget :

1. Tarification basée sur le volume : Notre modèle de tarification échelonné signifie que les commandes plus importantes entraînent des économies importantes par unité. De nombreux clients constatent que les commandes en gros réduisent en fait leur coût global par mois.

2. Flexibilité de paiement : Nous proposons des conditions de paiement flexibles - vous pouvez répartir le coût sur des paiements trimestriels ou mensuels plutôt qu'un investissement initial important.

3. Perspective du ROI : Examinons la valeur que cela apporte. Nos clients constatent généralement [avantage/ROI spécifique] dans les [délai], ce qui compense souvent l'investissement initial au cours du premier trimestre.

4. Package personnalisé : Je serais heureux de travailler avec vous pour créer un package personnalisé qui correspond à votre budget actuel tout en offrant la valeur essentielle dont vous avez besoin.

Seriez-vous ouvert à explorer l'une de ces options pour trouver une solution qui fonctionne pour votre budget ?`
          },
          {
            language_code: 'pl',
            title: 'Cena zbyt wysoka - Ograniczenia budżetowe',
            content: `Całkowicie rozumiem, że kwestie budżetowe są kluczowe dla każdej decyzji biznesowej. Pozwólcie, że pokażę Wam, jak możemy to ustrukturyzować, aby pasowało do Waszego budżetu:

1. Ceny oparte na wolumenie: Nasz model cenowy oznacza, że większe zamówienia skutkują znacznymi oszczędnościami na jednostkę. Wielu klientów zauważa, że zamówienia hurtowe faktycznie zmniejszają ich całkowity koszt miesięczny.

2. Elastyczność płatności: Oferujemy elastyczne warunki płatności - możecie rozłożyć koszty na płatności kwartalne lub miesięczne zamiast dużej inwestycji z góry.

3. Perspektywa ROI: Spójrzmy na wartość, jaką to przynosi. Nasi klienci zazwyczaj widzą [konkretną korzyść/ROI] w ciągu [ramy czasowe], co często kompensuje początkową inwestycję w pierwszym kwartale.

4. Pakiet niestandardowy: Chętnie współpracuję z Wami, aby stworzyć dostosowany pakiet, który pasuje do Waszego obecnego budżetu, a jednocześnie dostarcza podstawową wartość, której potrzebujecie.

Czy bylibyście otwarci na zbadanie jednej z tych opcji, aby znaleźć rozwiązanie, które działa dla Waszego budżetu?`
          }
        ]
      },
      {
        title: 'Need to think about it - Decision delay',
        category: 'timing',
        content: `I appreciate you taking the time to carefully consider this decision - that shows you're thorough in your evaluation process.

To help you make the most informed decision, may I ask:

1. What specific aspects would you like more clarity on? I want to make sure you have all the information you need.

2. Timeline: When would you ideally like to have a solution in place? Understanding your timeline helps me ensure we can support you when you're ready.

3. Decision criteria: What are the key factors you'll be evaluating? This helps me provide you with the most relevant information.

4. Next steps: Would it be helpful if I sent you a detailed proposal/summary you can review with your team? I can also schedule a follow-up call for [specific date] to address any questions that come up.

I'm here to support your decision-making process - what would be most helpful for you right now?`,
        tags: ['timing', 'decision', 'follow-up'],
        translations: []
      },
      {
        title: 'Currently working with competitor',
        category: 'competitor',
        content: `I respect your existing relationship and I'm not here to disrupt something that's working well for you. However, I'd love to share some unique advantages our clients find valuable:

1. Unique differentiators: 
   - [Specific feature/benefit #1 that competitor doesn't offer]
   - [Specific feature/benefit #2 that competitor doesn't offer]
   - [Specific feature/benefit #3 that competitor doesn't offer]

2. Complementary value: Many of our clients actually use us alongside [competitor name] because we excel in [specific area], which complements what they're already doing.

3. Risk-free trial: We could start with a small trial order so you can compare the quality and service directly, without any commitment to switch entirely.

4. What's missing: Out of curiosity, is there anything you wish your current supplier did differently or any gaps they don't quite fill?

I'm not asking you to make a switch - just to keep us in mind as a valuable alternative or complement to your current solution. What do you think?`,
        tags: ['competitor', 'differentiation', 'trial'],
        translations: []
      },
      {
        title: 'Not the decision maker - Need approval',
        category: 'authority',
        content: `Thank you for being transparent about the decision-making process. I really appreciate that, and I want to make this as easy as possible for you to bring this to [decision maker].

Here's how I can help:

1. Decision-maker brief: I can prepare a concise executive summary that highlights:
   - The business problem we solve
   - Key benefits and ROI
   - Pricing and timeline
   - Risk mitigation (guarantees, trial options)

2. Supporting materials: Would it be helpful if I provided:
   - Case studies from similar companies
   - ROI calculator or cost-benefit analysis
   - Comparison chart vs. current solution

3. Direct involvement: Would it make sense for me to:
   - Join you in presenting to [decision maker]
   - Prepare a brief presentation deck
   - Answer their questions directly via email or a quick call

4. Their concerns: From your perspective, what questions or concerns do you think [decision maker] will have? This helps me address them proactively.

What would make you most confident in recommending this to [decision maker]?`,
        tags: ['authority', 'decision-maker', 'approval'],
        translations: []
      },
      {
        title: 'Prove ROI - Show me the value',
        category: 'trust',
        content: `That's an excellent question, and I'm glad you're focused on tangible results. Let me share specific data and proof points:

1. Client results: Here are real examples from companies similar to yours:
   - [Client/Industry]: Achieved [specific metric] in [timeframe]
   - [Client/Industry]: Reduced [cost/time] by [percentage]
   - [Client/Industry]: Increased [revenue/efficiency] by [amount]

2. Measurable metrics: Based on your situation, here's what you can expect:
   - [Metric #1]: [Expected improvement]
   - [Metric #2]: [Expected improvement]
   - [Metric #3]: [Expected improvement]

3. ROI timeline: Most clients see:
   - Quick wins (30 days): [Specific result]
   - Medium term (90 days): [Specific result]
   - Long term (6-12 months): [Specific result]

4. Guarantee: To further reduce your risk, we offer [money-back guarantee/trial period/performance guarantee]. If you don't see [specific result] within [timeframe], we'll [specific action].

5. Proof: Would you like to:
   - Speak with a reference customer in your industry?
   - See a detailed case study?
   - Run a pilot program to measure results firsthand?

What specific metrics matter most to you? Let's focus on proving those first.`,
        tags: ['trust', 'roi', 'proof', 'case-study'],
        translations: []
      }
    ];

    for (const template of templates) {
      const [result] = await pool.query<ResultSetHeader>(
        'INSERT INTO resource_templates (title, category, content, tags) VALUES (?, ?, ?, ?)',
        [template.title, template.category, template.content, JSON.stringify(template.tags)]
      );

      const templateId = result.insertId;
      console.log(`✓ Created template: ${template.title}`);

      // Add translations
      for (const translation of template.translations) {
        await pool.query(
          'INSERT INTO resource_template_translations (template_id, language_code, title, content) VALUES (?, ?, ?, ?)',
          [templateId, translation.language_code, translation.title, translation.content]
        );
        console.log(`  ✓ Added ${translation.language_code.toUpperCase()} translation`);
      }
    }

    console.log('✅ Resource templates seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding resources:', error);
    process.exit(1);
  }
}

seedResources();
