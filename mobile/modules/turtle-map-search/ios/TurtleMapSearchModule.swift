import ExpoModulesCore
import MapKit

private let suggestionsEvent = "onSuggestions"
private let searchErrorEvent = "onSearchError"

private final class SearchCompleterDelegate: NSObject, MKLocalSearchCompleterDelegate {
  let onResults: (MKLocalSearchCompleter) -> Void
  let onError: (MKLocalSearchCompleter, any Error) -> Void

  init(onResults: @escaping (MKLocalSearchCompleter) -> Void, onError: @escaping (MKLocalSearchCompleter, any Error) -> Void) {
    self.onResults = onResults
    self.onError = onError
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    onResults(completer)
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: any Error) {
    onError(completer, error)
  }
}

public final class TurtleMapSearchModule: Module {
  private let completer = MKLocalSearchCompleter()
  private var completerDelegate: SearchCompleterDelegate?
  private var completionsByID: [String: MKLocalSearchCompletion] = [:]
  private var activeDirections: MKDirections?
  private var activeWaypointSearch: MKLocalSearch?

  public func definition() -> ModuleDefinition {
    Name("TurtleMapSearch")

    Events(suggestionsEvent, searchErrorEvent)

    OnCreate {
      let delegate = SearchCompleterDelegate(
        onResults: { [weak self] completer in self?.handleResults(completer) },
        onError: { [weak self] completer, error in self?.handleError(completer, error: error) }
      )
      completerDelegate = delegate
      completer.delegate = delegate
      if #available(iOS 18.0, *) {
        completer.resultTypes = [.address, .pointOfInterest, .physicalFeature]
      } else {
        completer.resultTypes = [.address, .pointOfInterest]
      }
    }

    OnDestroy {
      completer.cancel()
      completer.delegate = nil
      completerDelegate = nil
      completionsByID.removeAll()
      activeDirections?.cancel()
      activeDirections = nil
      activeWaypointSearch?.cancel()
      activeWaypointSearch = nil
    }

    AsyncFunction("updateQuery") { (query: String, latitude: Double, longitude: Double, latitudeDelta: Double, longitudeDelta: Double) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      guard trimmed.count >= 2 else {
        clearResults()
        return
      }

      completer.region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
        span: MKCoordinateSpan(
          latitudeDelta: max(latitudeDelta, 0.01),
          longitudeDelta: max(longitudeDelta, 0.01)
        )
      )
      completer.queryFragment = trimmed
    }
    .runOnQueue(.main)

    AsyncFunction("clear") {
      clearResults()
    }
    .runOnQueue(.main)

    AsyncFunction("resolveSuggestion") { (id: String, promise: Promise) in
      guard let completion = completionsByID[id] else {
        promise.reject("E_SUGGESTION_EXPIRED", "That place suggestion expired. Search again.")
        return
      }

      let request = MKLocalSearch.Request(completion: completion)
      request.region = completer.region
      let search = MKLocalSearch(request: request)
      search.start { response, error in
        if let error {
          promise.reject("E_PLACE_LOOKUP_FAILED", error.localizedDescription)
          return
        }
        guard let item = response?.mapItems.first else {
          promise.reject("E_PLACE_NOT_FOUND", "Apple Maps could not resolve that place.")
          return
        }

        let subtitle = completion.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = completion.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let label: String
        if subtitle.isEmpty {
          label = title
        } else if subtitle.lowercased().hasPrefix(title.lowercased()) {
          label = subtitle
        } else {
          label = "\(title), \(subtitle)"
        }
        promise.resolve([
          "label": label,
          "title": title,
          "subtitle": subtitle,
          "latitude": item.placemark.coordinate.latitude,
          "longitude": item.placemark.coordinate.longitude
        ])
      }
    }
    .runOnQueue(.main)

    AsyncFunction("resolveRouteWaypoint") { (
      query: String,
      centerLatitude: Double,
      centerLongitude: Double,
      latitudeDelta: Double,
      longitudeDelta: Double,
      promise: Promise
    ) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      guard trimmed.count >= 2 else {
        promise.reject("E_WAYPOINT_INVALID", "The requested via place is too short to search.")
        return
      }

      activeWaypointSearch?.cancel()
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = trimmed
      request.region = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: centerLatitude, longitude: centerLongitude),
        span: MKCoordinateSpan(
          latitudeDelta: max(latitudeDelta, 0.25),
          longitudeDelta: max(longitudeDelta, 0.25)
        )
      )
      let search = MKLocalSearch(request: request)
      activeWaypointSearch = search
      search.start { [weak self] response, error in
        if self?.activeWaypointSearch === search {
          self?.activeWaypointSearch = nil
        }
        if let error {
          promise.reject("E_WAYPOINT_LOOKUP_FAILED", error.localizedDescription)
          return
        }
        guard let item = response?.mapItems.first else {
          promise.reject("E_WAYPOINT_NOT_FOUND", "Apple Maps could not place \(trimmed) on this trip.")
          return
        }

        let title = item.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? trimmed
        let subtitle = [item.placemark.locality, item.placemark.administrativeArea]
          .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty && $0.caseInsensitiveCompare(title) != .orderedSame }
          .reduce(into: [String]()) { values, value in
            if !values.contains(where: { $0.caseInsensitiveCompare(value) == .orderedSame }) {
              values.append(value)
            }
          }
          .joined(separator: ", ")
        let label = subtitle.isEmpty ? title : "\(title), \(subtitle)"
        promise.resolve([
          "label": label,
          "title": title,
          "subtitle": subtitle,
          "latitude": item.placemark.coordinate.latitude,
          "longitude": item.placemark.coordinate.longitude
        ])
      }
    }
    .runOnQueue(.main)

    AsyncFunction("calculateRoute") { (
      originLatitude: Double,
      originLongitude: Double,
      destinationLatitude: Double,
      destinationLongitude: Double,
      travelMode: String,
      avoidTolls: Bool,
      avoidHighways: Bool,
      promise: Promise
    ) in
      activeDirections?.cancel()

      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
        latitude: originLatitude,
        longitude: originLongitude
      )))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
        latitude: destinationLatitude,
        longitude: destinationLongitude
      )))
      request.transportType = transportType(for: travelMode)
      request.requestsAlternateRoutes = false
      request.departureDate = Date()
      if #available(iOS 16.0, *) {
        request.tollPreference = avoidTolls ? .avoid : .any
        request.highwayPreference = avoidHighways ? .avoid : .any
      }

      let directions = MKDirections(request: request)
      activeDirections = directions
      directions.calculate { [weak self] response, error in
        if self?.activeDirections === directions {
          self?.activeDirections = nil
        }
        if let error {
          promise.reject("E_ROUTE_LOOKUP_FAILED", error.localizedDescription)
          return
        }
        guard let route = response?.routes.first else {
          promise.reject("E_ROUTE_NOT_FOUND", "Apple Maps could not find a route for this trip.")
          return
        }

        guard let payload = self?.routePayload(route) else {
          promise.reject("E_ROUTE_GEOMETRY_MISSING", "Apple Maps returned a route without display geometry.")
          return
        }
        promise.resolve(payload)
      }
    }
    .runOnQueue(.main)

    AsyncFunction("calculateRouteAlternatives") { (
      originLatitude: Double,
      originLongitude: Double,
      destinationLatitude: Double,
      destinationLongitude: Double,
      travelMode: String,
      avoidTolls: Bool,
      avoidHighways: Bool,
      promise: Promise
    ) in
      activeDirections?.cancel()

      let request = MKDirections.Request()
      request.source = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
        latitude: originLatitude,
        longitude: originLongitude
      )))
      request.destination = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
        latitude: destinationLatitude,
        longitude: destinationLongitude
      )))
      request.transportType = transportType(for: travelMode)
      request.requestsAlternateRoutes = true
      request.departureDate = Date()
      if #available(iOS 16.0, *) {
        request.tollPreference = avoidTolls ? .avoid : .any
        request.highwayPreference = avoidHighways ? .avoid : .any
      }

      let directions = MKDirections(request: request)
      activeDirections = directions
      directions.calculate { [weak self] response, error in
        if self?.activeDirections === directions {
          self?.activeDirections = nil
        }
        if let error {
          promise.reject("E_ROUTE_LOOKUP_FAILED", error.localizedDescription)
          return
        }
        guard let self else {
          promise.reject("E_ROUTE_LOOKUP_CANCELLED", "The route calculation ended before results were ready.")
          return
        }
        let alternatives = (response?.routes ?? []).prefix(3).compactMap { self.routePayload($0) }
        guard !alternatives.isEmpty else {
          promise.reject("E_ROUTE_NOT_FOUND", "Apple Maps could not find a route for this trip.")
          return
        }
        promise.resolve(Array(alternatives))
      }
    }
    .runOnQueue(.main)
  }

  private func transportType(for travelMode: String) -> MKDirectionsTransportType {
    switch travelMode {
    case "walking":
      return .walking
    case "cycling":
      return .cycling
    case "public_transit", "bus", "subway", "train":
      return .transit
    default:
      return .automobile
    }
  }

  private func routeCoordinates(_ polyline: MKPolyline) -> [[String: Double]] {
    let pointCount = polyline.pointCount
    guard pointCount > 0 else { return [] }

    var allCoordinates = Array(repeating: CLLocationCoordinate2D(), count: pointCount)
    polyline.getCoordinates(&allCoordinates, range: NSRange(location: 0, length: pointCount))

    let maximumDisplayPoints = 500
    let strideLength = max(1, Int(ceil(Double(pointCount) / Double(maximumDisplayPoints))))
    var displayCoordinates: [[String: Double]] = []
    for index in Swift.stride(from: 0, to: pointCount, by: strideLength) {
      let coordinate = allCoordinates[index]
      displayCoordinates.append([
        "latitude": coordinate.latitude,
        "longitude": coordinate.longitude
      ])
    }
    if (pointCount - 1) % strideLength != 0 {
      let coordinate = allCoordinates[pointCount - 1]
      displayCoordinates.append([
        "latitude": coordinate.latitude,
        "longitude": coordinate.longitude
      ])
    }
    return displayCoordinates
  }

  private func routePayload(_ route: MKRoute) -> [String: Any]? {
    let coordinates = routeCoordinates(route.polyline)
    guard coordinates.count >= 2 else { return nil }
    let stepInstructions = route.steps
      .map { $0.instructions.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    let navigationSteps: [[String: Any]] = route.steps.compactMap { step in
      let instruction = step.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
      let stepCoordinates = routeCoordinates(step.polyline)
      guard !instruction.isEmpty, let coordinate = stepCoordinates.first else { return nil }
      return [
        "instruction": instruction,
        "distanceMeters": step.distance,
        "coordinate": coordinate
      ]
    }
    return [
      "coordinates": coordinates,
      "distanceMeters": route.distance,
      "expectedTravelTimeSeconds": route.expectedTravelTime,
      "routeName": route.name,
      "advisoryNotices": route.advisoryNotices,
      "stepInstructions": stepInstructions,
      "navigationSteps": navigationSteps
    ]
  }

  private func handleResults(_ completer: MKLocalSearchCompleter) {
    completionsByID.removeAll()
    var seen = Set<String>()
    var suggestions: [[String: Any]] = []

    for completion in completer.results {
      let title = completion.title.trimmingCharacters(in: .whitespacesAndNewlines)
      let subtitle = completion.subtitle.trimmingCharacters(in: .whitespacesAndNewlines)
      let dedupeKey = "\(title.lowercased())|\(subtitle.lowercased())"
      guard !title.isEmpty, seen.insert(dedupeKey).inserted else { continue }

      let id = UUID().uuidString
      completionsByID[id] = completion
      suggestions.append([
        "id": id,
        "title": title,
        "subtitle": subtitle
      ])
      if suggestions.count == 6 { break }
    }

    sendEvent(suggestionsEvent, [
      "query": completer.queryFragment,
      "suggestions": suggestions
    ])
  }

  private func handleError(_ completer: MKLocalSearchCompleter, error: any Error) {
    completionsByID.removeAll()
    sendEvent(searchErrorEvent, [
      "query": completer.queryFragment,
      "message": error.localizedDescription
    ])
  }

  private func clearResults() {
    completer.cancel()
    completer.queryFragment = ""
    completionsByID.removeAll()
    sendEvent(suggestionsEvent, ["query": "", "suggestions": []])
  }
}
