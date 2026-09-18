export const senateMenuXml = `<?xml version="1.0" encoding="UTF-8"?>
<vote_summary>
  <congress>119</congress>
  <session>2</session>
  <votes>
    <vote>
      <vote_number>00234</vote_number>
      <vote_date>15-Sep</vote_date>
      <issue>H.R. 3633</issue>
      <question>On Cloture on the Motion to Proceed</question>
      <result>Rejected</result>
      <vote_tally><yeas>49</yeas><nays>50</nays></vote_tally>
      <title>Motion to Invoke Cloture: Motion to Proceed to H.R. 3633</title>
    </vote>
    <vote>
      <vote_number>00230</vote_number>
      <issue>PN1078</issue>
      <question>On the Nomination</question>
      <result>Confirmed</result>
      <vote_tally><yeas>50</yeas><nays>49</nays></vote_tally>
      <title>Confirmation: Example Nominee</title>
    </vote>
  </votes>
</vote_summary>
`;

export const senateVoteXml = `<?xml version="1.0" encoding="iso-8859-1"?>
<roll_call_vote>
  <congress>119</congress>
  <session>2</session>
  <vote_number>234</vote_number>
  <vote_date>September 15, 2026,  02:19 PM</vote_date>
  <question>On Cloture on the Motion to Proceed</question>
  <vote_title>Motion to Invoke Cloture: Motion to Proceed to H.R. 3633</vote_title>
  <vote_result>Cloture on the Motion to Proceed Rejected</vote_result>
  <majority_requirement>3/5</majority_requirement>
  <document>
    <document_congress>119</document_congress>
    <document_type>H.R.</document_type>
    <document_number>3633</document_number>
    <document_name>H.R. 3633</document_name>
    <document_title>Digital commodities bill</document_title>
    <document_short_title>CLARITY Act</document_short_title>
  </document>
  <count><yeas>49</yeas><nays>50</nays><present /><absent>1</absent></count>
  <members>
    <member>
      <last_name>Baldwin</last_name>
      <first_name>Tammy</first_name>
      <party>D</party>
      <state>WI</state>
      <vote_cast>Nay</vote_cast>
      <lis_member_id>S354</lis_member_id>
    </member>
    <member>
      <last_name>Barrasso</last_name>
      <first_name>John</first_name>
      <party>R</party>
      <state>WY</state>
      <vote_cast>Yea</vote_cast>
      <lis_member_id>S317</lis_member_id>
    </member>
  </members>
</roll_call_vote>
`;
