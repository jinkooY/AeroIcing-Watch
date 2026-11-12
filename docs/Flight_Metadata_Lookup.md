# Flight metadata lookup

`GET /api/route-review/flights/lookup` takes `flight_number` in IATA or ICAO form and `departure_local_date` as YYYY-MM-DD in the departure airport's local calendar. The adapter calls the AeroDataBox Direct Gateway single-day endpoint with `dateLocalRole=Departure`. Coverage and fields can vary by airport, date and subscription. [Direct API specification](https://doc.aerodatabox.com/docs/openapi-direct-v1.json) · [Date semantics](https://aerodatabox.com/flight-history/) · [Coverage](https://aerodatabox.com/data-coverage)

## Configuration

The adapter is disabled by default. An authorized private demo can set `AERODATABOX_ENABLE_DEMO_LOOKUP=1` and `AERODATABOX_API_KEY` in the server environment. The key goes in the provider request header. AeroDataBox terms restrict real flight planning and operations, and constrain onward distribution. Use synthetic responses in a public demonstration unless the applicable agreement permits the intended display. [AeroDataBox terms, articles 4 and 5](https://aerodatabox.com/terms)

Example request shape for a demo server with authorized access.

```text
GET /api/route-review/flights/lookup?flight_number=KL682&departure_local_date=2026-11-12
```

The response includes provider and retrieval time, query, state and a candidate list in provider order. It keeps all returned flight numbers, callsigns and codeshare statuses. A candidate index identifies a row within that response. Airport and time fields can be null. Scheduled, revised, predicted, runway and explicitly supplied actual times are separate. AeroDataBox's documented revised and runway fields can contain actual or estimated times, so those fields retain their source meaning. The single-day contract can omit a dedicated actual timestamp.

Aircraft model, recognized subtype, registration and Mode S code are included where present. Exact subtype matches such as A320-214 can yield a compatible OpenAP engine suggestion based on the EASA type certificate. The suggestion describes a model option and the installed engine remains unconfirmed. Generic models or unknown subtypes leave engine selection manual. The lookup supplies airport metadata, while the route evaluation uses separately supplied waypoints and mass. [EASA.A.064, A320 engine section](https://www.easa.europa.eu/en/downloads/16507/en)

HTTP 200 can contain zero, one or multiple candidates. The endpoint returns 422 for invalid input, 503 when disabled or provider rate limited, 502 for provider rejection or invalid responses, and 504 for timeout. Responses carry no-store for provider results and provider errors. The adapter was verified with mocked responses without a live provider request.
