"""Starter Terms & Conditions seeded onto a new organisation's OrgSettings.

A fresh org gets this sample T&C template so its quotes/sign pages aren't blank
on day one — the same "usable defaults" philosophy as the choice-option and
catalog seeding. It is market-neutral (bracketed placeholders, not a filled-in
policy) and the owner is expected to edit it in Settings before using it with
real clients. Seeded once at org creation via the ``post_save`` signal (and set
for the demo org by ``seed_demo``); never overwrites an org's own edits.
"""

DEFAULT_QUOTATION_TERMS = """# [Your Catering Business Name] — Terms & Conditions of Service

**Effective Date:** [Date]

These Terms & Conditions ("Terms") govern all catering services provided by [Your Catering Business Name] ("Company," "we," "us") to the client named on the accompanying quote, invoice, or contract ("Client," "you"). By submitting a deposit, signing a proposal, or otherwise confirming a booking, you agree to be bound by these Terms.

## 1. Booking & Confirmation
- A booking is only confirmed once (a) a signed proposal/contract and (b) the required deposit have both been received.
- Provisional dates are held for [7] days without a deposit, after which the date may be released to other clients.
- Final guest count, menu selections, and event details must be confirmed in writing no later than [10 business days] before the event date.
- The final invoice will be based on the confirmed guest count or the actual attendance, whichever is greater.

## 2. Pricing & Payment
- All quotes are valid for [30] days from the date of issue and are subject to change based on final menu, guest count, and service requirements.
- A non-refundable deposit of [25–50%] of the estimated total is required to secure your date.
- The remaining balance is due no later than [5 business days] before the event, unless otherwise agreed in writing.
- Accepted payment methods: [bank transfer / credit card / check]. A [3%] surcharge may apply to credit card payments.
- Late payments may incur a fee of [1.5%] per month on the outstanding balance and may result in suspension of services.
- Prices exclude applicable sales tax, service charge, and gratuity unless stated otherwise.

## 3. Cancellations & Rescheduling
- Cancellations must be submitted in writing (email is acceptable).
- Cancellations more than [60] days before the event: deposit is forfeited; no further charges apply.
- Cancellations between [30–59] days before the event: [50%] of the total estimated invoice is due.
- Cancellations within [29] days of the event: [100%] of the total estimated invoice is due, as costs (staffing, perishable goods, rentals) will already have been committed.
- One complimentary date change is permitted if requested at least [45] days in advance and subject to availability; further changes may incur an administrative fee of [$100].
- The Company reserves the right to cancel services due to circumstances beyond its control (see Section 9, Force Majeure), in which case any payments made will be refunded less costs already incurred.

## 4. Guest Count & Menu Changes
- The Client is responsible for providing an accurate final guest count by the deadline in Section 1.
- Reductions in guest count after the final count deadline will not be refunded.
- Increases in guest count after the deadline will be accommodated subject to availability and may incur additional charges and a short-notice fee.
- Menu substitutions after the deadline are subject to ingredient availability and may incur additional cost.

## 5. Dietary Requirements & Allergies
- The Client must disclose all known food allergies, intolerances, and dietary requirements (e.g., vegetarian, vegan, gluten-free, religious requirements) at the time of final menu confirmation.
- While the Company takes reasonable precautions, our kitchen handles common allergens (including nuts, dairy, gluten, shellfish, and soy) and we cannot guarantee any dish is entirely free of cross-contact.
- The Company is not liable for allergic reactions arising from undisclosed dietary requirements or from cross-contact in a shared kitchen environment.

## 6. Venue, Equipment & Access
- The Client is responsible for ensuring the venue is accessible for setup, delivery, and breakdown at the agreed times, and for providing any required permits.
- The Client must confirm availability of essential utilities (power, water, refrigeration, adequate workspace) as specified in the event proposal.
- Rental items (linens, tableware, glassware, furniture, equipment) remain the property of the Company or its rental partners. The Client is responsible for any loss or damage to rented items beyond normal wear, at replacement cost.
- Additional fees may apply for excessive delivery distance, difficult access (e.g., stairs, no parking, no loading dock), or setup/breakdown outside standard hours.

## 7. Staffing & Service Time
- Quoted staffing (servers, chefs, bartenders) covers the agreed service window as specified in the proposal. Additional hours beyond that window will be billed at [$__/hour per staff member].
- The Company reserves the right to substitute staff of comparable experience due to illness or unforeseen circumstances.
- Company staff will conduct themselves professionally; any concerns during the event should be raised immediately with the on-site event lead.

## 8. Alcohol Service (if applicable)
- Where the Company provides bartending or alcohol service, it will be conducted in accordance with applicable local licensing laws, including age verification.
- The Company reserves the right to refuse service to any guest who appears intoxicated or is behaving in a manner that endangers themselves or others.
- The Client is responsible for obtaining any event-specific alcohol permits required by the venue or local authority, unless otherwise agreed.

## 9. Force Majeure
Neither party will be liable for failure to perform its obligations due to events beyond its reasonable control, including but not limited to extreme weather, natural disaster, fire, government restrictions, public health emergencies, strikes, or utility failures. In such cases, the parties will work in good faith to reschedule the event; any non-recoverable costs already incurred by the Company (e.g., perishable food purchased, non-refundable rentals) may be deducted from any refund due.

## 10. Liability & Insurance
- The Company carries [general liability / product liability] insurance and will provide a certificate of insurance upon request.
- The Company's total liability arising from these Terms or the services provided shall not exceed the total amount paid by the Client for the event.
- The Company is not liable for indirect, incidental, or consequential damages, including loss of enjoyment, arising from the event.
- The Client agrees to indemnify the Company against claims arising from the Client's guests' conduct, except where caused by the Company's negligence.

## 11. Photography & Marketing
The Company may photograph food and event setup (excluding identifiable guests without consent) for portfolio and marketing purposes, unless the Client opts out in writing prior to the event.

## 12. Governing Law & Disputes
These Terms are governed by the laws of [State/Country]. Any disputes arising from these Terms or the services provided will first be addressed through good-faith negotiation and, if unresolved, through [mediation / arbitration / the courts of [Jurisdiction]].

## 13. Contact
Questions about these Terms or an upcoming event should be directed to:

[Business Name]
[Address]
[Phone] | [Email] | [Website]

---

Disclaimer: This is a general sample template for illustration purposes only and does not constitute legal advice. Catering, food safety, alcohol licensing, and consumer-contract rules vary by location — have these Terms reviewed by a qualified attorney in your jurisdiction before using them with clients."""
